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
 * `CHROME_PATH` wins so a user with an unusual install can always say where.
 * @type {string[]}
 */
export const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
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
 * Poll Chrome's DevTools HTTP endpoint until it exposes a page target, and
 * return that page's own socket URL. Connecting straight to the page avoids
 * attaching to a target and threading a session id through every command.
 * @param {number} port
 * @param {number} [timeoutMs]
 * @returns {Promise<string>}
 */
export async function waitForPageTarget(port, timeoutMs = 20000) {
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
    if (Date.now() > deadline) throw new Error('Chrome did not expose a page target in time');
    await new Promise((r) => setTimeout(r, 150));
  }
}

/**
 * Minimal CDP client: send a command, await its reply by id.
 * @param {string} wsUrl
 */
export function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  /** @type {Map<number, {resolve:Function, reject:Function}>} */
  const pending = new Map();
  let nextId = 1;

  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve(undefined));
    ws.addEventListener('error', (e) => reject(new Error(`CDP socket failed: ${e.message || e}`)));
  });

  ws.addEventListener('message', (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    const p = msg.id != null && pending.get(msg.id);
    if (!p) return;
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
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close: () => ws.close(),
  };
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
 * @template T
 * @param {{chromePath:string, width:number, height:number, scale?:number, debugPort?:number, extraArgs?:string[]}} opts
 * @param {(client: ReturnType<typeof connect>) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withChrome(opts, fn) {
  const { chromePath, width, height, scale = 1, extraArgs = [] } = opts;
  const debugPort = opts.debugPort || (await freePort());
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'deckhq-shot-'));

  const child = spawn(
    chromePath,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${debugPort}`,
      `--window-size=${width},${height}`,
      ...extraArgs,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  /** @type {ReturnType<typeof connect>|undefined} */
  let client;
  try {
    const wsUrl = await waitForPageTarget(debugPort);
    client = connect(wsUrl);
    await client.ready;
    await client.send('Page.enable');
    await client.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: scale,
      mobile: false,
    });
    return await fn(client);
  } finally {
    client?.close();
    child.kill();
    // Chrome holds the profile directory open for a moment after SIGTERM; on
    // Windows removing it too early throws EBUSY. It is a temp directory
    // either way, so a failure here is never worth failing the capture over.
    await new Promise((r) => setTimeout(r, 1500));
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch {
      /* the OS will reap it */
    }
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
