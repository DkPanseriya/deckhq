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
 *   1. **Find a daemon** on loopback: the port the user named, then the one a
 *      running daemon published in `~/.deckhq/daemon.json` (WP-37,
 *      `docs/DEVIATIONS.md` §102), then the port the installed hooks post to
 *      (§83), then the 4317.. walk. A daemon that answers is reused — this
 *      command never starts a second one beside a healthy one.
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
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { DATA_DIR } from '../core/paths.mjs';
import { readDaemonFile } from '../core/daemon-file.mjs';
import {
  appProfileDir,
  appWindowCommand,
  defaultBrowserCommand,
  isLoopbackUrl,
} from '../core/app-window.mjs';
import { DEFAULT_PORT, PORT_SCAN_SPAN, askDaemon, probeLoopbackPort } from './source.mjs';

/** `bin/deckhq.mjs`, resolved from this file rather than from the PATH. */
export const BIN = fileURLToPath(new URL('../../bin/deckhq.mjs', import.meta.url));

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
 * Ports worth asking about, most likely first.
 *
 * Pure, and separate from `source.mjs`'s `candidatePorts` because the order is
 * different and the difference matters: the status line deliberately refuses
 * to load the adapter registry for a hook port (§92, a 20 ms budget), and this
 * command deliberately does, because starting a second daemon beside the one
 * the hooks are feeding is precisely the degraded state §83 exists to prevent.
 *
 * @param {{explicit?:number|null, published?:number|null, hooks?:number[],
 *          span?:number}} [opts]
 * @returns {number[]}
 */
export function candidateAppPorts(opts = {}) {
  /** @type {number[]} */
  const ordered = [];
  const add = (p) => {
    const n = Number(p);
    if (Number.isInteger(n) && n > 0 && n < 65536 && !ordered.includes(n)) ordered.push(n);
  };
  add(opts.explicit);
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
 * The first port on this machine that answers `/api/state` like a DeckHQ, or
 * null.
 *
 * @param {{port?:number|null, timeoutMs?:number, ask?:typeof askDaemon,
 *          probe?:typeof probeLoopbackPort, ports?:number[]}} [opts]
 * @returns {Promise<{port:number, url:string}|null>}
 */
export async function findRunningDaemon(opts = {}) {
  const ask = opts.ask || askDaemon;
  const probe = opts.probe || probeLoopbackPort;
  const timeoutMs = opts.timeoutMs ?? FIND_TIMEOUT_MS;
  const ports =
    opts.ports ||
    candidateAppPorts({
      explicit: opts.port ?? null,
      published: readDaemonFile()?.port ?? null,
      hooks: await hookPorts(),
    });

  const open = await Promise.all(ports.map((p) => probe(p, timeoutMs)));
  for (const port of ports.filter((_p, i) => open[i])) {
    const found = await ask(port, timeoutMs);
    if (found) return { port, url: `http://127.0.0.1:${port}/` };
  }
  return null;
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
 * @param {{port?:number|null, timeoutMs?:number, pollMs?:number,
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
    const found = await find({ port: opts.port ?? null });
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
  '  --port <n>     look for, or start, a daemon on this port',
  '  --width <n>    the window, on its very first run. Default 1600',
  '  --height <n>   the same. Default 1000',
  '  --no-window    reuse or start the daemon and print the URL; open nothing',
  '  --help         this message',
  '',
  'Reuses a DeckHQ that is already running — the port you named, the one a',
  'running daemon published in ~/.deckhq/daemon.json, the one your installed',
  'hooks post to, then 4317 upward. If none answers, it starts one in the',
  'background and waits up to ten seconds for it.',
  '',
  'The window is Chrome or Edge in application mode: no tab strip, no address',
  'bar, its own taskbar button, and its own browser profile under',
  '~/.deckhq/app-profile so it keeps its size and never shares your tabs.',
  'A machine with neither falls back to your default browser and says so.',
  '',
  'Makes no outbound network calls.',
  '',
].join('\n');

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
 *          findBrowser?:() => string|null, spawnFn?:typeof spawn,
 *          dataDir?:string, platform?:NodeJS.Platform|string}} [deps]
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
  const port = num('--port');

  const find = deps.find || findRunningDaemon;
  const start = deps.start || startDetachedDaemon;

  let daemon;
  try {
    const running = await find({ port });
    if (running) {
      daemon = { ...running, started: false, timedOut: false, pid: null };
    } else {
      daemon = await start({ port });
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

  write(
    `\n  DeckHQ  ${daemon.url}` +
      (daemon.started ? '  (started just now)' : '  (already running)') +
      '\n',
  );

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
  return 0;
}

export default runApp;
