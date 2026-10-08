/**
 * `deckhq app` — WP-62, the floor as an application, from one command.
 *
 *     deckhq app
 *     deckhq app --port 4400
 *
 * `docs/plan/08-PLAN-V2-100X.md` §1.1 rule 5 scores every feature against
 * §1.2: does it reduce the time the user must spend looking at DeckHQ per unit
 * of agent output? A tab does not. A tab has no taskbar button, no icon, no
 * remembered size and no window of its own — so the floor is either buried
 * behind forty other tabs or kept in front of everything, and the second is
 * the failure mode §1.2 names by name. An application window is the container
 * this product should always have had: alt-tab reaches it, it keeps its
 * geometry, and closing it costs nothing because the daemon outlives it.
 *
 * What this command does, in order:
 *
 *   1. **Find a daemon** on loopback. A port the user named — `--port`, or
 *      `DECKHQ_PORT` — is the only port asked: a DeckHQ there is reused, an
 *      empty port gets a daemon started on it, and anything else on it is a
 *      failure that says so. With no port named, the search is the one a
 *      running daemon published in `~/.deckhq/daemon.json` (WP-37,
 *      `docs/DEVIATIONS.md` §102), then the port the installed hooks post to
 *      (§83), then the 4317.. walk — and a daemon found that way is reused
 *      only if it serves THIS state directory (`stateDirId`). A daemon that
 *      answers and is ours is reused — this command never starts a second one
 *      beside a healthy one, and never opens a window on somebody else's.
 *   2. **Otherwise spawn `deckhq --no-open`, detached**, with its stdio
 *      ignored and `unref()`'d, so the window outlives this process and this
 *      process does not outlive the command. Then wait up to ten seconds for
 *      `/api/state` to answer.
 *   3. **Open the floor in an app window**: Chrome or Edge with `--app=`, from
 *      the same discovery `doctor --capture-proof` already uses. A machine
 *      with no Chromium-family browser falls back to the default browser and
 *      is told so in one line.
 *
 * Nothing here kills a process it did not start. A daemon that was already
 * running is left exactly as it was, including on every failure path.
 *
 * No egress: every socket opened is to 127.0.0.1, and the URL handed to the
 * browser is asserted loopback before it is spawned.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

import { DATA_DIR } from '../core/paths.mjs';
import { readDaemonFile, stateDirId } from '../core/daemon-file.mjs';
import {
  appProfileDir,
  appWindowCommand,
  defaultBrowserCommand,
  isLoopbackUrl,
} from '../core/app-window.mjs';
import { DEFAULT_PORT, PORT_SCAN_SPAN, askDaemon, probeLoopbackPort } from './source.mjs';
// WP-92i. `BIN` lived here and `shortcut.mjs` imported it, which was the one
// static edge of the `app → pin → shortcut → app` cycle. It lives in the module
// all three share now; see its header.
import { BIN } from './offers.mjs';

/** How long a spawned daemon has to answer `/api/state` before we give up. */
export const START_TIMEOUT_MS = 10_000;

/** How often that wait asks. */
export const START_POLL_MS = 200;

/**
 * How long the pre-spawn search may take. Longer than the status line's 150 ms
 * (`source.mjs`) on purpose: this command is about to start a browser, so a
 * few hundred milliseconds spent not starting a redundant daemon is the
 * cheapest thing it will do.
 */
export const FIND_TIMEOUT_MS = 600;

/**
 * How long the window this command just opened has to exist before its
 * taskbar id is read. Only ever spent on the run after a shortcut was written
 * or the browser changed; see `src/core/launcher-taskbar.mjs`.
 */
export const WINDOW_WAIT_MS = 8000;

/**
 * Ports worth asking about, most likely first.
 *
 * Pure, and separate from `source.mjs`'s `candidatePorts` because the order is
 * different and the difference matters: the status line deliberately refuses
 * to load the adapter registry for a hook port (§92, a 20 ms budget), and this
 * command deliberately does, because starting a second daemon beside the one
 * the hooks are feeding is precisely the degraded state §83 exists to prevent.
 *
 * A port the user named is not in this list, and that is the point of it: a
 * named port is asked alone (`findRunningDaemon`), never as the first of many.
 *
 * @param {{published?:number|null, hooks?:number[], span?:number}} [opts]
 * @returns {number[]}
 */
export function candidateAppPorts(opts = {}) {
  /** @type {number[]} */
  const ordered = [];
  const add = (p) => {
    const n = Number(p);
    if (Number.isInteger(n) && n > 0 && n < 65536 && !ordered.includes(n)) ordered.push(n);
  };
  add(opts.published);
  for (const p of opts.hooks || []) add(p);
  const span = opts.span ?? PORT_SCAN_SPAN;
  for (let p = DEFAULT_PORT; p < DEFAULT_PORT + span; p++) add(p);
  return ordered;
}

/** The port every hook-capable adapter says its installed hooks post to. */
async function hookPorts() {
  /** @type {number[]} */
  const ports = [];
  try {
    const { getAdapters } = await import('../adapters/index.mjs');
    for (const adapter of getAdapters()) {
      const hooks = adapter?.hooks;
      if (!hooks || !hooks.supported || typeof hooks.installedPort !== 'function') continue;
      try {
        const port = await hooks.installedPort();
        if (typeof port === 'number') ports.push(port);
      } catch {
        // An unreadable settings file costs this command its shortcut and
        // nothing else; the 4317.. walk still runs.
      }
    }
  } catch {
    /* no registry, no hook ports */
  }
  return ports;
}

/**
 * The DeckHQ this command should use, or null when it has to start one.
 *
 * Two different questions, and running them together was the bug this shape
 * exists to prevent (a named port used to be the first of a dozen asked, so
 * `--port 4317` with nothing on 4317 opened whatever answered next):
 *
 *   - **A port was named.** That port is asked and no other. A DeckHQ there is
 *     the answer whatever state directory it serves — naming a port is naming
 *     a daemon.
 *   - **No port was named.** The published port, the hooks' port, then 4317
 *     upward — and only a daemon that says it serves this state directory
 *     counts. One from a build too old to say is believed only on the port
 *     this directory's own `daemon.json` names, because that file is the one
 *     other piece of evidence that it is ours.
 *
 * @param {{port?:number|null, dataDir?:string, timeoutMs?:number,
 *          ask?:typeof askDaemon, probe?:typeof probeLoopbackPort,
 *          ports?:number[], stateId?:string, published?:number|null}} [opts]
 * @returns {Promise<{port:number, url:string}|null>}
 */
export async function findRunningDaemon(opts = {}) {
  const ask = opts.ask || askDaemon;
  const probe = opts.probe || probeLoopbackPort;
  const timeoutMs = opts.timeoutMs ?? FIND_TIMEOUT_MS;
  const at = (port) => ({ port, url: `http://127.0.0.1:${port}/` });

  if (opts.port != null) {
    const named = Number(opts.port);
    if (!(await probe(named, timeoutMs))) return null;
    return (await ask(named, timeoutMs)) ? at(named) : null;
  }

  const dataDir = opts.dataDir || DATA_DIR;
  const published =
    opts.published !== undefined
      ? opts.published
      : (readDaemonFile(path.join(dataDir, 'daemon.json'))?.port ?? null);
  const mine = opts.stateId || stateDirId(dataDir);
  const ports = opts.ports || candidateAppPorts({ published, hooks: await hookPorts() });

  const open = await Promise.all(ports.map((p) => probe(p, timeoutMs)));
  for (const port of ports.filter((_p, i) => open[i])) {
    const found = await ask(port, timeoutMs);
    if (!found) continue;
    const theirs = found.snapshot?.stateDirId;
    const ours = typeof theirs === 'string' && theirs ? theirs === mine : port === published;
    if (ours) return at(port);
  }
  return null;
}

/**
 * What a named port that no DeckHQ answered on is doing: `true` when something
 * else is listening there. Asked only after `findRunningDaemon` said null, so
 * a listener here is one that did not answer `/api/state` like a DeckHQ.
 *
 * @param {number} port
 * @param {{probe?:typeof probeLoopbackPort, timeoutMs?:number}} [opts]
 * @returns {Promise<boolean>}
 */
export function namedPortIsTaken(port, opts = {}) {
  return (opts.probe || probeLoopbackPort)(port, opts.timeoutMs ?? FIND_TIMEOUT_MS);
}

/**
 * What this command says when the port it was told to use is somebody else's.
 * @param {number} port
 */
export function portTakenMessage(port) {
  return (
    `\n  Port ${port} is in use, and what is using it did not answer as a DeckHQ.\n` +
    '  You named that port, so nothing was started and no other port was tried.\n' +
    '  Stop what is on it, or name another: `deckhq app --port <n>`.\n\n'
  );
}

/**
 * Start a daemon in the background and wait for it to answer.
 *
 * `detached: true` with `stdio: 'ignore'` and `unref()` is the whole contract:
 * the daemon is not this command's child in any sense that matters, it holds
 * no pipe this process must drain, and this process exits the moment the
 * window is open. On Windows `detached` also gives it its own console, which
 * `windowsHide` then keeps off the screen — without that flag the user gets a
 * black console window beside their app window, which is exactly the "extra
 * step" this package exists to delete.
 *
 * A named port goes to the daemon as `--port`, and the wait asks that port
 * and no other, so a daemon already running somewhere else can never be
 * mistaken for the one this just started.
 *
 * @param {{port?:number|null, dataDir?:string, timeoutMs?:number, pollMs?:number,
 *          find?:typeof findRunningDaemon, spawnFn?:typeof spawn,
 *          bin?:string, node?:string, now?:() => number,
 *          sleep?:(ms:number) => Promise<void>}} [opts]
 * @returns {Promise<{port:number, url:string, pid:number|null,
 *                    started:true, timedOut:boolean}>}
 */
export async function startDetachedDaemon(opts = {}) {
  const spawnFn = opts.spawnFn || spawn;
  const find = opts.find || findRunningDaemon;
  const now = opts.now || (() => Date.now());
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const args = [opts.bin || BIN, '--no-open'];
  if (opts.port != null) args.push('--port', String(opts.port));

  const child = spawnFn(opts.node || process.execPath, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref?.();
  const pid = typeof child.pid === 'number' ? child.pid : null;

  const deadline = now() + (opts.timeoutMs ?? START_TIMEOUT_MS);
  for (;;) {
    const found = await find({ port: opts.port ?? null, dataDir: opts.dataDir });
    if (found) return { ...found, pid, started: true, timedOut: false };
    if (now() >= deadline) break;
    await sleep(opts.pollMs ?? START_POLL_MS);
  }
  return {
    port: Number(opts.port) || DEFAULT_PORT,
    url: `http://127.0.0.1:${Number(opts.port) || DEFAULT_PORT}/`,
    pid,
    started: true,
    timedOut: true,
  };
}

/**
 * How the floor will be opened on this machine: an app window if a
 * Chromium-family browser is here, the default browser otherwise.
 *
 * @param {{url:string, platform?:NodeJS.Platform|string, dataDir?:string,
 *          browser?:string|null, width?:number, height?:number}} opts
 * @returns {{mode:'app'|'default', browser:string|null,
 *            command:{command:string, args:string[]}|null}}
 */
export function planOpen(opts) {
  const platform = opts.platform || process.platform;
  const browser = opts.browser ?? null;
  if (browser) {
    const command = appWindowCommand({
      platform,
      browser,
      url: opts.url,
      profileDir: appProfileDir(opts.dataDir || DATA_DIR),
      width: opts.width,
      height: opts.height,
    });
    if (command) return { mode: 'app', browser, command };
  }
  return {
    mode: 'default',
    browser: null,
    command: defaultBrowserCommand({ platform, url: opts.url }),
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const HELP = [
  'deckhq app — the floor in a window of its own.',
  '',
  'Usage: deckhq app [--port <n>] [--width <n>] [--height <n>]',
  '',
  '  --port <n>     use this port and no other: reuse the DeckHQ on it, or start',
  '                 one there. DECKHQ_PORT does the same; --port wins over it',
  '  --width <n>    the window, on its very first run. Default 1600',
  '  --height <n>   the same. Default 1000',
  '  --no-window    reuse or start the daemon and print the URL; open nothing',
  '  --dry-run      print what this would start and what it would open, and do',
  '                 neither. Starts nothing, opens nothing, writes nothing.',
  '  --pin          ask whether to put DeckHQ on your Desktop and Start Menu,',
  '                 even if that question has been answered before',
  '  --no-pin       never ask',
  '  --help         this message',
  '',
  'With a port named, that port is the whole search: a DeckHQ on it is reused,',
  'an empty port gets one started on it, and a port held by something else is',
  'an error — no other port is tried.',
  '',
  'With none named, it reuses a DeckHQ that is already running for this state',
  'directory — the port a running daemon published in ~/.deckhq/daemon.json,',
  'the one your installed hooks post to, then 4317 upward. A DeckHQ serving',
  'another state directory (DECKHQ_STATE_DIR) is left alone. If none answers,',
  'it starts one in the background and waits up to ten seconds for it.',
  '',
  'The window is Chrome or Edge in application mode: no tab strip, no address',
  'bar, its own taskbar button, and its own browser profile under',
  '~/.deckhq/app-profile so it keeps its size and never shares your tabs.',
  'A machine with neither falls back to your default browser and says so.',
  '',
  'The first time this opens a window on a machine with no DeckHQ shortcut on',
  'it, it prints the paths `deckhq shortcut --install` would write and asks once',
  'whether to write them. Anything but "y" writes nothing and it never asks',
  'again. Off a terminal it asks nothing and prints the command instead.',
  '',
  'Makes no outbound network calls.',
  '',
].join('\n');

/**
 * `DECKHQ_PORT` as a port, or null. An unusable value names nothing, which is
 * how the daemon itself reads it (`bin/deckhq.mjs`).
 * @param {string|undefined} raw
 * @returns {number|null}
 */
function namedPort(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : null;
}

/**
 * @param {string[]} argv
 * @param {string} name
 * @returns {string|null}
 */
function option(argv, name) {
  const i = argv.indexOf(name);
  if (i === -1 || i === argv.length - 1) return null;
  return argv[i + 1];
}

/**
 * Run the command. Returns an exit code rather than calling `process.exit()`,
 * for the reason every other subcommand does: exiting hard while a loopback
 * socket is still closing aborts the process inside libuv
 * (`docs/DEVIATIONS.md` §76).
 *
 * @param {string[]} [argv]
 * @param {{write?:(s:string)=>void, error?:(s:string)=>void,
 *          find?:typeof findRunningDaemon, start?:typeof startDetachedDaemon,
 *          probe?:typeof probeLoopbackPort, env?:Record<string,string|undefined>,
 *          findBrowser?:() => string|null, spawnFn?:typeof spawn,
 *          dataDir?:string, platform?:NodeJS.Platform|string,
 *          offerPin?:(argv:string[], deps:any) => Promise<any>, tty?:boolean,
 *          matchTaskbar?:((opts:any) => Promise<string>)|null,
 *          node?:string, bin?:string}} [deps]
 * @returns {Promise<number>}
 */
export async function runApp(argv = [], deps = {}) {
  const write = deps.write || ((s) => process.stdout.write(s));
  const error = deps.error || ((s) => process.stderr.write(s));

  if (argv.includes('--help') || argv.includes('-h')) {
    write(HELP);
    return 0;
  }

  const num = (name) => {
    const raw = option(argv, name);
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
  };
  // A port named on the command line, or failing that in the environment, is
  // the port. Not a hint, not the first of several: see `findRunningDaemon`.
  const flagPort = num('--port');
  if (argv.includes('--port') && !(flagPort != null && flagPort < 65536)) {
    error('\n  --port needs a port number, 1 to 65535. Nothing was started.\n\n');
    return 1;
  }
  const port = flagPort ?? namedPort((deps.env || process.env).DECKHQ_PORT);

  const find = deps.find || findRunningDaemon;
  const start = deps.start || startDetachedDaemon;
  const dryRun = argv.includes('--dry-run');
  const { dataDir, probe } = deps;

  // `--dry-run` is what a stranger runs first, and what the tarball test runs
  // on a machine with no browser and no intention of starting anything. It
  // does the one thing that is free and reversible — ask loopback whether a
  // DeckHQ is already there — and then says, in full, what the run without it
  // would do. It spawns nothing, writes nothing and asks nothing.
  if (dryRun) return await dryRunApp(argv, { ...deps, port, find, write, error });

  let daemon;
  try {
    const running = await find({ port, dataDir });
    if (running) {
      daemon = { ...running, started: false, timedOut: false, pid: null };
    } else if (port != null && (await namedPortIsTaken(port, { probe }))) {
      error(portTakenMessage(port));
      return 1;
    } else {
      daemon = await start({ port, dataDir });
    }
  } catch (err) {
    error(`\n  ${err?.message || err}\n\n`);
    return 1;
  }

  if (daemon.timedOut) {
    error(
      `\n  A DeckHQ was started in the background${daemon.pid ? ` (pid ${daemon.pid})` : ''} but it ` +
        `did not answer ${daemon.url}api/state within ${Math.round(START_TIMEOUT_MS / 1000)}s.\n` +
        '  It has been left running rather than killed — it may simply be slow to bind.\n' +
        '  Run `deckhq doctor` to see what it found, or `deckhq app` again in a moment.\n\n',
    );
    return 1;
  }

  // Rule 2: nothing but loopback is ever handed to a browser.
  if (!isLoopbackUrl(daemon.url)) {
    error(`\n  Refusing to open ${daemon.url}: DeckHQ only ever opens 127.0.0.1.\n\n`);
    return 1;
  }

  // Which of the three things happened, because they are three different
  // answers to "is this the floor I meant".
  const how = !daemon.started
    ? 'already running'
    : port != null
      ? 'started on the port you named'
      : 'started just now';
  write(`\n  DeckHQ  ${daemon.url}  (${how})\n`);

  if (argv.includes('--no-window')) {
    write('\n');
    return 0;
  }

  // The browser discovery `doctor --capture-proof` and the README capture
  // already share. One answer to "where is Chrome" in this package, not two.
  let browser = null;
  try {
    browser = deps.findBrowser ? deps.findBrowser() : (await import('./chrome.mjs')).findChrome();
  } catch {
    browser = null;
  }

  const plan = planOpen({
    url: daemon.url,
    platform: deps.platform,
    dataDir: deps.dataDir,
    browser,
    width: num('--width') ?? undefined,
    height: num('--height') ?? undefined,
  });

  if (!plan.command) {
    error(`\n  DeckHQ could not work out how to open a browser on this platform.\n\n`);
    return 1;
  }

  try {
    const spawnFn = deps.spawnFn || spawn;
    // NO `windowsHide` HERE, and it is not an oversight. On Windows that
    // option sets `STARTF_USESHOWWINDOW` with `SW_HIDE` in the child's
    // STARTUPINFO, and Chrome takes `nCmdShow` from STARTUPINFO for its
    // **first window**. Measured on the reference machine: the browser
    // process started, the GPU process and three renderers started, the page
    // loaded — and `EnumWindows` found no window at all, while the identical
    // argv run by hand produced one titled "(7) DeckHQ" in under a second.
    // `docs/DEVIATIONS.md` §144. The daemon spawn above keeps the flag,
    // because there the hidden window is the console nobody wants.
    spawnFn(plan.command.command, plan.command.args, {
      detached: true,
      stdio: 'ignore',
    }).unref?.();
  } catch (err) {
    error(`\n  Could not open the window: ${err?.message || err}\n\n`);
    return 1;
  }

  if (plan.mode === 'app') {
    write(`  Opened as an app window — ${plan.browser}\n\n`);
  } else {
    write(
      '  No Chrome, Edge or Chromium was found, so this opened in your default browser\n' +
        '  as an ordinary tab. Install one of those, or set CHROME_PATH, for a window\n' +
        '  of its own.\n\n',
    );
  }

  // The taskbar pin. Windows draws a pin of this window from the shortcut that
  // carries the window's own id, and from the browser when none does;
  // `src/core/launcher-taskbar.mjs` has the measurement. Only for a window this
  // run really opened — an injected spawn opened nothing, so there is nothing
  // to read — and it runs nothing at all once the record says it is done.
  if (plan.mode === 'app') {
    try {
      const match =
        deps.matchTaskbar ??
        (deps.spawnFn ? null : (await import('../core/launcher-taskbar.mjs')).matchAppWindow);
      if (match) {
        const { platform } = deps;
        write(await match({ dataDir, platform, browser, url: daemon.url, waitMs: WINDOW_WAIT_MS }));
      }
    } catch {
      /* a pin with the browser's icon is not a window that failed to open */
    }
  }

  // WP-75. After the window, never before it: the offer is for a thing the
  // user can now see. It writes nothing without an answer, and it asks at most
  // once per machine. Its failure is never this command's failure — the window
  // is already open, and that was the job.
  try {
    const offer = deps.offerPin || (await import('./pin.mjs')).offerPin;
    await offer(argv, { write, error, dataDir: deps.dataDir, tty: deps.tty });
  } catch {
    /* an offer that could not be made costs nothing */
  }

  return 0;
}

/**
 * `--dry-run`: everything this command would do, and none of it.
 *
 * @param {string[]} argv
 * @param {{write:(s:string)=>void, error:(s:string)=>void, port?:number|null,
 *          find:typeof findRunningDaemon, probe?:typeof probeLoopbackPort,
 *          findBrowser?:() => string|null,
 *          dataDir?:string, platform?:NodeJS.Platform|string,
 *          node?:string, bin?:string}} deps
 * @returns {Promise<number>}
 */
async function dryRunApp(argv, deps) {
  const { write } = deps;
  const node = deps.node || process.execPath;
  const bin = deps.bin || BIN;

  let running = null;
  try {
    running = await deps.find({ port: deps.port ?? null, dataDir: deps.dataDir });
  } catch {
    running = null;
  }
  // The one thing the real run refuses to do, it refuses here too.
  if (!running && deps.port != null && (await namedPortIsTaken(deps.port, deps))) {
    deps.error(portTakenMessage(deps.port));
    return 1;
  }

  const port = running?.port ?? (Number(deps.port) || DEFAULT_PORT);
  const url = running?.url ?? `http://127.0.0.1:${port}/`;

  write('\n  --dry-run: nothing below was started, opened or written.\n\n');
  write(
    running
      ? `  Daemon:  ${url}  (already running — it would be reused)\n`
      : (deps.port
          ? `  Daemon:  nothing is on port ${deps.port}, the port you named, so it would start\n` +
            '           one there, detached:\n'
          : '  Daemon:  none answered, so it would start one, detached:\n') +
          `             ${node} ${bin} --no-open` +
          (deps.port ? ` --port ${deps.port}` : '') +
          '\n' +
          `           then wait for ${url}api/state\n`,
  );

  let browser = null;
  try {
    browser = deps.findBrowser ? deps.findBrowser() : (await import('./chrome.mjs')).findChrome();
  } catch {
    browser = null;
  }

  if (argv.includes('--no-window')) {
    write('  Window:  none — --no-window\n');
  } else {
    const plan = planOpen({
      url,
      platform: deps.platform,
      dataDir: deps.dataDir,
      browser,
    });
    write(
      plan.mode === 'app'
        ? `  Window:  an app window — ${plan.browser}\n`
        : '  Window:  your default browser, as an ordinary tab — no Chrome, Edge or\n' +
            '           Chromium was found\n',
    );
    if (plan.command) {
      write(`             ${plan.command.command} ${plan.command.args.join(' ')}\n`);
    }
  }
  write('\n');
  return 0;
}

export default runApp;
