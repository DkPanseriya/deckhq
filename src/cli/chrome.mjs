/**
 * Driving a headless Chrome over the DevTools Protocol, without a dependency.
 *
 * Factored out of `scripts/capture-floor.mjs` so `deckhq doctor --capture-proof`
 * and the README capture share one answer to "where is Chrome, and how do I get
 * a PNG out of it". Two implementations of that would drift, and the "find
 * Chrome" list is the part that goes stale first.
 *
 * This lives under `src/` rather than `scripts/` on purpose: `scripts/` is not
 * in package.json's `files` list, so anything the shipped CLI needs at runtime
 * has to be here or it simply is not installed for the user.
 *
 * NOTE ON NODE VERSIONS. The CDP client below needs a global `WebSocket`, which
 * Node only has unflagged from 22. The package supports Node 18, so nothing in
 * the always-on path may import this module eagerly — `doctor` imports it
 * dynamically, only inside `--capture-proof`, and `hasWebSocket()` lets the
 * caller degrade with a sentence instead of a stack trace.
 *
 * No network egress: every socket opened here is to 127.0.0.1, talking to a
 * Chrome this process spawned itself.
 */
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

/**
 * Where a Chromium-family browser is likely to be, most-preferred first.
 * `CHROME_PATH` wins so a user with an unusual install can always say where;
 * `CHROME_BIN` is the same escape hatch under the name CI images and Puppeteer
 * already set, and the GitHub Ubuntu runner is the machine that matters here.
 * @type {string[]}
 */
export const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.CHROME_BIN,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/microsoft-edge',
  '/snap/bin/chromium',
].filter(Boolean);

/**
 * Bare names to look for on PATH when no absolute candidate exists. Last
 * resort, on purpose: an absolute path is a browser we can name in an error
 * message, and this pass only ever adds machines that would otherwise have
 * been reported as having no browser at all.
 * @type {string[]}
 */
export const CHROME_PATH_NAMES = [
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
  'microsoft-edge',
];

/**
 * The first candidate that exists on this machine, or null.
 *
 * Returns null rather than throwing: a missing browser is a normal outcome for
 * `doctor --capture-proof` (it prints a sentence and still exits 0), and only
 * the README capture script treats it as fatal.
 * @returns {string|null}
 */
export function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // an unreadable path is simply not the one
    }
  }
  // Nothing at a known absolute path. Some images (containers, self-hosted
  // runners) only put the browser on PATH, so walk that before giving up.
  const dirs = String(process.env.PATH || process.env.Path || '')
    .split(path.delimiter)
    .map((d) => d.trim())
    .filter(Boolean);
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  for (const dir of dirs) {
    for (const name of CHROME_PATH_NAMES) {
      for (const ext of exts) {
        try {
          const file = path.join(dir, name + ext);
          if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
        } catch {
          // an unreadable path is simply not the one
        }
      }
    }
  }
  return null;
}

/** Does this Node have the global WebSocket the CDP client needs? */
export function hasWebSocket() {
  return typeof globalThis.WebSocket === 'function';
}

/**
 * A loopback port nothing is listening on right now, from the OS.
 *
 * There is an unavoidable race between closing this listener and Chrome
 * binding the port, but it beats a hard-coded 9222 that collides with the
 * user's own debugging session — which is a confusing failure, because Chrome
 * silently attaches to the existing instance instead.
 * @returns {Promise<number>}
 */
export function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
      server.close(() => resolve(port));
    });
  });
}

/**
 * The `code` on every error that means "this machine could not give us a
 * working browser". Callers that are allowed to degrade — the goldens gate,
 * `doctor --capture-proof` — match on it so they skip a tooling gap without
 * also swallowing a real failure from the work they came to do.
 */
export const CHROME_UNAVAILABLE = 'CHROME_UNAVAILABLE';

/**
 * @param {string} message
 * @returns {Error & {code:string}}
 */
export function chromeUnavailable(message) {
  const err = /** @type {Error & {code:string}} */ (new Error(message));
  err.code = CHROME_UNAVAILABLE;
  return err;
}

/**
 * How long to wait for a freshly spawned Chrome to expose a page target.
 * Chrome on a shared CI runner is an order of magnitude slower to start than
 * Chrome on a laptop — cold page cache, no warm profile, a CPU it is sharing —
 * so the budget is not the same number in both places. It is a hang guard
 * either way; a healthy Chrome answers in about a second.
 */
export const TARGET_TIMEOUT_MS = 20_000;
export const TARGET_TIMEOUT_MS_CI = 60_000;

/** How many times a launch that never produced a page target is tried again. */
export const LAUNCH_ATTEMPTS = 3;

/**
 * Poll Chrome's DevTools HTTP endpoint until it exposes a page target, and
 * return that page's own socket URL. Connecting straight to the page avoids
 * attaching to a target and threading a session id through every command.
 *
 * `died` lets the caller report a Chrome that exited instead of listening, so
 * a browser that refuses to start (no sandbox, no /dev/shm, a bad flag) fails
 * in a second with its own reason rather than after the whole budget with
 * none.
 *
 * @param {number} port
 * @param {number} [timeoutMs]
 * @param {() => string|null} [died] why the process is already gone, or null
 * @returns {Promise<string>}
 */
export async function waitForPageTarget(port, timeoutMs = TARGET_TIMEOUT_MS, died = () => null) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (res.ok) {
        const targets = await res.json();
        const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (page) return page.webSocketDebuggerUrl;
      }
    } catch {
      /* not up yet */
    }
    const gone = died();
    if (gone) throw chromeUnavailable(`Chrome ${gone} before it exposed a page target`);
    if (Date.now() > deadline) {
      throw chromeUnavailable(
        `Chrome did not expose a page target on 127.0.0.1:${port} within ${Math.round(timeoutMs / 1000)}s`,
      );
    }
    await new Promise((r) => setTimeout(r, 150));
  }
}

/**
 * How long one CDP command may go unanswered before it is given up on.
 *
 * Generous, because it is a hang guard and not a budget: a healthy
 * `Page.captureScreenshot` of a 1600x1000 floor answers in tens of
 * milliseconds, and the slowest legitimate command measured on a shared runner
 * was under two seconds. What this bounds is the case where no answer is ever
 * coming — see `send`.
 */
export const CDP_COMMAND_TIMEOUT_MS = 60_000;

/**
 * Minimal CDP client: send a command, await its reply by id.
 *
 * Every command is bounded, in two independent ways, and neither is
 * decoration (docs/DEVIATIONS.md §126.3):
 *
 *   - **The socket closing rejects everything still pending.** A renderer that
 *     is OOM-killed, a browser that exits, a target that crashes — all of them
 *     end as a closed WebSocket with no reply on the wire. Without this, every
 *     in-flight promise simply stays pending, and `await client.send(...)`
 *     becomes an unkillable wait with no output at all. That is the shape of a
 *     hang that reads in CI as `cancelled`, which is the least informative
 *     verdict there is.
 *   - **A per-command deadline**, for the narrower case where the socket is
 *     healthy and the answer is not coming anyway.
 *
 * @param {string} wsUrl
 * @param {{timeoutMs?:number}} [opts]
 */
export function connect(wsUrl, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? CDP_COMMAND_TIMEOUT_MS;
  const ws = new WebSocket(wsUrl);
  /** @type {Map<number, {resolve:Function, reject:Function, method:string, timer:any}>} */
  const pending = new Map();
  let nextId = 1;
  /** @type {Error|null} */
  let dead = null;

  /** Fail everything still waiting, and refuse anything sent afterwards. */
  const abandon = (reason) => {
    if (dead) return;
    dead = new Error(reason);
    for (const [id, p] of pending) {
      clearTimeout(p.timer);
      pending.delete(id);
      p.reject(new Error(`${reason} (waiting on ${p.method})`));
    }
  };

  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve(undefined));
    ws.addEventListener('error', (e) => reject(new Error(`CDP socket failed: ${e.message || e}`)));
  });

  ws.addEventListener('close', () => abandon('the CDP socket closed'));
  ws.addEventListener('error', () => abandon('the CDP socket failed'));

  ws.addEventListener('message', (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    const p = msg.id != null && pending.get(msg.id);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(`${msg.error.message} (${msg.method || ''})`));
    else p.resolve(msg.result);
  });

  return {
    ready,
    /**
     * @param {string} method
     * @param {Record<string, any>} [params]
     * @returns {Promise<any>}
     */
    send(method, params = {}) {
      if (dead) return Promise.reject(new Error(`${dead.message} (cannot send ${method})`));
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP ${method} did not answer within ${timeoutMs} ms`));
        }, timeoutMs);
        if (typeof timer.unref === 'function') timer.unref();
        pending.set(id, { resolve, reject, method, timer });
        try {
          ws.send(JSON.stringify({ id, method, params }));
        } catch (err) {
          clearTimeout(timer);
          pending.delete(id);
          reject(err);
        }
      });
    },
    close: () => {
      abandon('the CDP client was closed');
      ws.close();
    },
  };
}

/**
 * The flags a headless Chrome needs on this platform and nowhere else.
 *
 * All three are Linux-only, and deliberately so: the argv on Windows and macOS
 * is byte-for-byte what it has always been, so the goldens committed against
 * it stay valid.
 *
 *   --no-sandbox / --disable-setuid-sandbox
 *     Container and CI kernels routinely have user namespaces off, and the
 *     zygote then dies at startup with no page target ever appearing. The page
 *     being rendered is our own loopback demo floor, so there is nothing here
 *     for the sandbox to contain.
 *   --disable-dev-shm-usage
 *     /dev/shm is 64 MB in most containers; Chrome's default shared-memory
 *     backing overruns it and the renderer is killed mid-capture.
 *
 * @param {string} platform
 * @returns {string[]}
 */
export function platformLaunchArgs(platform = process.platform) {
  if (platform !== 'linux') return [];
  return ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];
}

/**
 * Spawn one Chrome and connect to its first page target, or throw a
 * {@link CHROME_UNAVAILABLE} error saying why it could not be done.
 * @param {{chromePath:string, width:number, height:number, debugPort:number,
 *          extraArgs:string[], targetTimeoutMs:number}} opts
 */
async function launchChrome(opts) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'deckhq-shot-'));
  /** @type {string[]} */
  const noise = [];
  /** @type {string|null} */
  let died = null;

  const child = spawn(
    opts.chromePath,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      ...platformLaunchArgs(),
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${opts.debugPort}`,
      `--window-size=${opts.width},${opts.height}`,
      ...opts.extraArgs,
      'about:blank',
    ],
    // stderr is read rather than dropped: when Chrome refuses to start it says
    // exactly why on it, and that sentence is the whole value of the SKIPPED
    // line this failure now produces instead of a stack trace.
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  child.stderr?.on('data', (d) => {
    if (noise.length < 20) noise.push(String(d).trim());
  });
  child.once('error', (err) => {
    died = `could not be spawned (${err.message})`;
  });
  child.once('exit', (code, signal) => {
    died = signal ? `was killed by ${signal}` : `exited with ${code}`;
  });

  const dispose = async () => {
    try {
      child.kill();
    } catch {
      /* already gone */
    }
    // Chrome holds the profile directory open for a moment after SIGTERM; on
    // Windows removing it too early throws EBUSY. It is a temp directory
    // either way, so a failure here is never worth failing the capture over.
    await new Promise((r) => setTimeout(r, 1500));
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch {
      /* the OS will reap it */
    }
  };

  try {
    const wsUrl = await waitForPageTarget(opts.debugPort, opts.targetTimeoutMs, () => died);
    const client = connect(wsUrl);
    await client.ready;
    return { client, dispose };
  } catch (err) {
    await dispose();
    const said = noise.join(' ').slice(0, 400);
    throw chromeUnavailable(`${err.message}${said ? ` — Chrome said: ${said}` : ''}`);
  }
}

/**
 * Launch a headless Chrome, hand a connected CDP client to `fn`, and tear
 * everything down afterwards whatever happens.
 *
 * The viewport is set through `Emulation.setDeviceMetricsOverride` as well as
 * `--window-size`, because headless Chrome does not always honour the flag and
 * a screenshot at the wrong size is worse than no screenshot.
 *
 * `extraArgs` are appended to Chrome's command line; the goldens harness uses
 * them for the rendering-determinism flags a README capture has no need of.
 *
 * A launch that never produces a page target is retried on a **fresh debugging
 * port**. The port is picked by asking the OS for a free one and then handing
 * it to Chrome, so there is an unavoidable window in which something else can
 * take it; on a CI runner opening and closing sockets constantly that window
 * is not theoretical, and the symptom is indistinguishable from a slow Chrome.
 * An explicitly requested `debugPort` is kept across attempts — the caller
 * asked for that port and retrying elsewhere would surprise it.
 *
 * @template T
 * @param {{chromePath:string, width:number, height:number, scale?:number,
 *          debugPort?:number, extraArgs?:string[], attempts?:number,
 *          targetTimeoutMs?:number}} opts
 * @param {(client: ReturnType<typeof connect>) => Promise<T>} fn
 * @returns {Promise<T>}
 * @throws an error with `code === CHROME_UNAVAILABLE` when no attempt produced
 *   a usable browser. Errors from `fn` itself are never retried and never
 *   retagged.
 */
export async function withChrome(opts, fn) {
  const { chromePath, width, height, scale = 1, extraArgs = [] } = opts;
  const attempts = Math.max(1, opts.attempts ?? LAUNCH_ATTEMPTS);
  const targetTimeoutMs =
    opts.targetTimeoutMs ?? (process.env.CI ? TARGET_TIMEOUT_MS_CI : TARGET_TIMEOUT_MS);

  /** @type {{client: ReturnType<typeof connect>, dispose: () => Promise<void>}|null} */
  let launched = null;
  /** @type {Error|null} */
  let lastError = null;
  for (let attempt = 1; attempt <= attempts && !launched; attempt++) {
    const debugPort = opts.debugPort || (await freePort());
    try {
      launched = await launchChrome({
        chromePath,
        width,
        height,
        debugPort,
        extraArgs,
        targetTimeoutMs,
      });
    } catch (err) {
      lastError = /** @type {Error} */ (err);
    }
  }
  if (!launched) {
    throw chromeUnavailable(
      `Chrome at ${chromePath} could not be started in ${attempts} attempt(s): ${lastError?.message}`,
    );
  }

  const { client, dispose } = launched;
  try {
    await client.send('Page.enable');
    await client.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: scale,
      mobile: false,
    });
    return await fn(client);
  } finally {
    client.close();
    await dispose();
  }
}

/**
 * Render a self-contained HTML string and write a PNG of it to `outFile`.
 *
 * The HTML is written to a temp file and loaded over `file://` rather than as a
 * `data:` URL: a data URL has no origin, which changes how Chrome treats the
 * document, and its length limits are an unpleasant surprise to hit later.
 *
 * @param {{html:string, outFile:string, width:number, height:number, scale?:number, settleMs?:number, chromePath?:string}} opts
 * @returns {Promise<string>} the path written
 */
export async function screenshotHtml(opts) {
  const { html, outFile, width, height, scale = 2, settleMs = 400 } = opts;
  const chromePath = opts.chromePath || findChrome();
  if (!chromePath) throw new Error('No Chrome or Edge found');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deckhq-card-'));
  const htmlFile = path.join(dir, 'card.html');
  fs.writeFileSync(htmlFile, html, 'utf8');

  try {
    return await withChrome({ chromePath, width, height, scale }, async (client) => {
      await client.send('Page.navigate', { url: pathToFileUrl(htmlFile) });
      // The card is static and has no external assets, so a short fixed wait
      // covers layout and font metrics without needing a load event.
      await new Promise((r) => setTimeout(r, settleMs));
      const { data } = await client.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      });
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      fs.writeFileSync(outFile, Buffer.from(data, 'base64'));
      return outFile;
    });
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* temp dir; the OS will reap it */
    }
  }
}

/**
 * `file://` URL for an absolute path, correct on Windows drive letters too.
 * @param {string} p
 */
export function pathToFileUrl(p) {
  const abs = path.resolve(p).replace(/\\/g, '/');
  return `file://${abs.startsWith('/') ? '' : '/'}${abs}`;
}
