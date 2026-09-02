/**
 * Screenshot a running DeckHQ floor, for the README.
 *
 * Chrome's `--screenshot` flag is no use here: it waits for the page to go
 * quiet, and DeckHQ deliberately never does — it holds an SSE stream open and
 * runs an animation loop for as long as the tab is visible. So this drives
 * Chrome over the DevTools Protocol instead, gives the floor a fixed settling
 * time, and captures on demand.
 *
 *   node scripts/demo-floor.mjs                      # terminal 1
 *   node scripts/capture-floor.mjs --url http://127.0.0.1:4499/
 *
 * Point it at the demo floor, never at a real one: the output is committed to
 * a public repository and a real floor carries real project names and session
 * titles.
 *
 * No dependencies — Node 22+ has a WebSocket client built in.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

const URL_ = opt('--url', 'http://127.0.0.1:4499/');
const OUT = path.resolve(opt('--out', 'docs/media/floor.png'));
const WIDTH = Number(opt('--width', 1600));
const HEIGHT = Number(opt('--height', 900));
const SCALE = Number(opt('--scale', 1));
const SETTLE_MS = Number(opt('--settle', 6000));
const DEBUG_PORT = Number(opt('--debug-port', 9222));
/** A key to press before capturing, e.g. `j` to open the review queue panel. */
const PRESS = opt('--press', '');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

function findChrome() {
  for (const c of CHROME_CANDIDATES) if (fs.existsSync(c)) return c;
  throw new Error('No Chrome or Edge found. Set CHROME_PATH to the executable and try again.');
}

/**
 * Poll the DevTools HTTP endpoint until Chrome exposes a page target, and
 * return that page's own socket URL. Connecting straight to the page avoids
 * attaching to a target and threading a session id through every command.
 */
async function waitForPageTarget(port, timeoutMs = 20000) {
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

/** Minimal CDP client: send a command, await its reply by id. */
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
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

const chrome = findChrome();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'deckhq-shot-'));

const child = spawn(
  chrome,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--window-size=${WIDTH},${HEIGHT}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

let client;
try {
  const wsUrl = await waitForPageTarget(DEBUG_PORT);
  client = connect(wsUrl);
  await client.ready;

  await client.send('Page.enable');
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: SCALE,
    mobile: false,
  });
  await client.send('Page.navigate', { url: URL_ });

  // The floor keeps animating forever, so there is no "load complete" to wait
  // for. Give it a fixed settling window instead: enough for the scan, the
  // first SSE snapshot, the backdrop bake and the walk animations to finish.
  await new Promise((r) => setTimeout(r, SETTLE_MS));

  // Dismiss first-run onboarding if it is showing, so the shot is of the floor.
  await client.send('Runtime.evaluate', {
    expression: `(() => {
      const d = document.getElementById('onboarding-dialog');
      if (d && d.open) { document.getElementById('onboarding-dismiss')?.click(); return 'dismissed'; }
      return 'not shown';
    })()`,
  });
  await new Promise((r) => setTimeout(r, 1500));

  // Optionally drive one keyboard shortcut before the shot — `j` walks the
  // needs-you queue and opens the side panel, which is what shows that the
  // floor is a work surface and not just a picture.
  if (PRESS) {
    for (const type of ['keyDown', 'keyUp']) {
      await client.send('Input.dispatchKeyEvent', {
        type,
        key: PRESS,
        text: type === 'keyDown' ? PRESS : undefined,
        windowsVirtualKeyCode: PRESS.toUpperCase().charCodeAt(0),
      });
    }
    await new Promise((r) => setTimeout(r, 2500));
  }

  const { data } = await client.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, Buffer.from(data, 'base64'));
  const kb = Math.round(fs.statSync(OUT).size / 1024);
  process.stdout.write(`wrote ${OUT}  ${WIDTH * SCALE}x${HEIGHT * SCALE}  ${kb} KB\n`);
} finally {
  client?.close();
  child.kill();
  // Chrome holds the profile directory open for a moment after SIGTERM; on
  // Windows removing it too early throws EBUSY. It is a temp directory either
  // way, so a failure here is not worth failing the capture over.
  await new Promise((r) => setTimeout(r, 1500));
  try {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch {
    /* the OS will reap it */
  }
}
