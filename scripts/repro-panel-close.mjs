/**
 * WP-61 · Does closing the agent side panel close the browser tab?
 *
 * The owner reported that dismissing the review card took the whole Chrome tab
 * with it. Whether a page is *allowed* to close itself is browser policy, not
 * a DOM fact, so this drives a real Chrome over the DevTools Protocol and
 * watches the page target. `test/unit/panel-close.test.mjs` is the gate that
 * runs everywhere; this is the reproduction that says what the browser does.
 *
 * What it does, end to end:
 *
 *   1. starts `scripts/demo-floor.mjs` on a free port, in its own temp fixture
 *      (nothing real is read or written — see that script's header),
 *   2. launches a headless Chrome **with the floor's URL on the command line**,
 *      not `about:blank` followed by a navigation. That detail is the whole
 *      experiment. Blink refuses `window.close()` with "Scripts may close only
 *      the windows that were opened by them" when the frame has more than one
 *      back/forward entry; a tab opened straight at a URL — which is what
 *      `deckhq` itself does when it opens the browser, and what `deckhq open`
 *      and the VS Code webview do — has exactly one, and the call is
 *      permitted. Navigating there from `about:blank` makes it two and hides
 *      the bug,
 *   3. opens the panel on an agent and drives every close path in turn — the ✕
 *      button, `Escape`, a click on the floor, `J`/`K` then `Escape`, and the
 *      palette's close — with `window.close`, `window.open` and the three
 *      `history` navigations replaced by counters, so a path that reaches one
 *      is named instead of ending the run,
 *   4. finally presses ✕ once more with nothing shimmed, and asks the browser
 *      endpoint whether the page target survived.
 *
 * Exit 1 means at least one close path reached a window-closing API. Exit 0
 * means none did. No Chrome, or a Node with no WebSocket client, is SKIPPED
 * and exit 0 — this is a diagnostic, never a gate.
 *
 *     node scripts/repro-panel-close.mjs [--port N]
 *
 * Every process this script starts is one it stops.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  connect,
  findChrome,
  freePort,
  hasWebSocket,
  waitForPageTarget,
} from '../src/cli/chrome.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** @param {string} s */
const say = (s) => process.stdout.write(`${s}\n`);

/** The counters the page is given in place of the real window-closing APIs. */
const SHIM = `(() => {
  if (!window.__wp61) {
    window.__wp61 = { close: 0, open: 0, back: 0, forward: 0, go: 0, notes: [] };
    window.close = () => { window.__wp61.close++; };
    window.open = () => { window.__wp61.open++; return null; };
    for (const name of ['back', 'forward', 'go']) {
      const real = history[name].bind(history);
      history[name] = (...a) => { window.__wp61[name]++; return real(...a); };
    }
    const warn = console.warn.bind(console);
    console.warn = (...a) => { window.__wp61.notes.push(a.join(' ')); warn(...a); };
  }
  return true;
})()`;

const RESET = `(window.__wp61.close = window.__wp61.open = window.__wp61.back =
  window.__wp61.forward = window.__wp61.go = 0, window.__wp61.notes.length = 0, true)`;

// --------------------------------------------------------------- the floor

/**
 * Start the demo floor and resolve its URL, read off its own stdout rather
 * than guessed.
 * @param {number} port
 */
async function startDemo(port) {
  const child = spawn(
    process.execPath,
    [path.join(ROOT, 'scripts', 'demo-floor.mjs'), '--port', String(port)],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let out = '';
  child.stdout.on('data', (d) => {
    out += String(d);
  });
  child.stderr.on('data', (d) => {
    out += String(d);
  });
  const deadline = Date.now() + 60_000;
  let url = null;
  while (Date.now() < deadline && !url) {
    const m = out.match(/https?:\/\/127\.0\.0\.1:\d+\/?/);
    if (m) url = m[0];
    else if (child.exitCode !== null) throw new Error(`the demo floor exited:\n${out}`);
    else await sleep(200);
  }
  if (!url) throw new Error(`the demo floor never printed a URL:\n${out}`);
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(new URL('/api/state', url));
      if (res.ok) {
        const body = await res.json();
        if (Array.isArray(body.agents) && body.agents.length > 0) break;
      }
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  return {
    url,
    /** Only ever the pid this script started. */
    stop: async () => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      await sleep(500);
    },
  };
}

// -------------------------------------------------------------- the browser

/**
 * Launch a Chrome whose FIRST page is the floor, so the tab has one history
 * entry and `window.close()` is permitted — the condition the owner's tab was
 * in.
 * @param {string} chromePath
 * @param {string} url
 */
async function launchAt(chromePath, url) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'deckhq-repro-'));
  const debugPort = await freePort();
  const child = spawn(
    chromePath,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      ...(process.platform === 'linux'
        ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        : []),
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${debugPort}`,
      '--window-size=1600,1000',
      url,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  /** @type {string|null} */
  let died = null;
  child.once('error', (err) => {
    died = `could not be spawned (${err.message})`;
  });
  child.once('exit', (code, signal) => {
    died = signal ? `was killed by ${signal}` : `exited with ${code}`;
  });
  const wsUrl = await waitForPageTarget(debugPort, 30_000, () => died);
  const client = connect(wsUrl);
  await client.ready;
  return {
    client,
    debugPort,
    dispose: async () => {
      client.close();
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      await sleep(1200);
      try {
        fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
      } catch {
        /* the OS will reap it */
      }
    },
  };
}

/** How many page targets this browser still has. @param {number} debugPort */
async function pageTargets(debugPort) {
  try {
    const res = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
    if (!res.ok) return -1;
    return (await res.json()).filter((/** @type {any} */ t) => t.type === 'page').length;
  } catch {
    return -1;
  }
}

// ------------------------------------------------------------------ the run

async function main() {
  if (!hasWebSocket()) {
    say('SKIPPED · this Node has no WebSocket client (Node 22+ needed).');
    return 0;
  }
  const chromePath = findChrome();
  if (!chromePath) {
    say('SKIPPED · no Chrome or Edge found.');
    return 0;
  }

  const demo = await startDemo(Number(opt('--port', 0)) || (await freePort()));
  say(`floor    ${demo.url}`);
  /** @type {Awaited<ReturnType<typeof launchAt>>|null} */
  let browser = null;
  /** @type {string[]} */
  const guilty = [];
  try {
    browser = await launchAt(chromePath, demo.url);
    const { client, debugPort } = browser;
    say(`chrome   127.0.0.1:${debugPort}`);
    await client.send('Runtime.enable');
    await client.send('Page.enable');
    await sleep(7000);

    /** @param {string} expr */
    const evaluate = async (expr) => {
      const r = await client.send('Runtime.evaluate', {
        expression: expr,
        awaitPromise: true,
        returnByValue: true,
      });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'the page threw');
      return r.result?.value;
    };

    /** @param {string} key @param {string} code @param {number} vk */
    const press = async (key, code, vk) => {
      for (const type of key.length === 1 ? ['keyDown', 'char', 'keyUp'] : ['keyDown', 'keyUp']) {
        await client.send('Input.dispatchKeyEvent', {
          type,
          key,
          code,
          text: key.length === 1 ? key : undefined,
          windowsVirtualKeyCode: vk,
          nativeVirtualKeyCode: vk,
        });
      }
      await sleep(300);
    };
    const tab = () => press('Tab', 'Tab', 9);
    const enter = () => press('Enter', 'Enter', 13);
    const escape = () => press('Escape', 'Escape', 27);
    const j = () => press('j', 'KeyJ', 74);
    const k = () => press('k', 'KeyK', 75);

    const panelOpen = () =>
      evaluate(
        `(() => { const r = document.getElementById('panel'); return Boolean(r) && !r.hidden; })()`,
      );

    /** Open the review card the way a keyboard user does: deck, cursor, Enter. */
    const showPanel = async () => {
      if (await panelOpen()) return true;
      await evaluate(`(document.activeElement && document.activeElement.blur(), true)`);
      await tab();
      await j();
      await enter();
      if (await panelOpen()) return true;
      // A deck that would not open leaves one more route: the floor's own
      // click handler, aimed at the first agent the Scene will admit to.
      await evaluate(`(() => {
        const c = document.getElementById('floor-canvas');
        if (!c) return false;
        const r = c.getBoundingClientRect();
        c.dispatchEvent(new MouseEvent('click', { bubbles: true,
          clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
        return true;
      })()`);
      await sleep(400);
      return await panelOpen();
    };

    /**
     * Run one close path with the shim in place and report what it reached.
     * @param {string} name
     * @param {() => Promise<any>} run
     */
    const drive = async (name, run) => {
      const opened = await showPanel();
      await evaluate(SHIM);
      await evaluate(RESET);
      if (!opened) {
        say(`  ${name.padEnd(24)} SKIPPED (the panel would not open)`);
        return;
      }
      await run();
      await sleep(500);
      const reached = JSON.parse(await evaluate('JSON.stringify(window.__wp61)'));
      const hit = ['close', 'open', 'back', 'forward', 'go'].filter((key) => reached[key] > 0);
      if (hit.length) {
        guilty.push(name);
        say(`  ${name.padEnd(24)} REACHED ${hit.map((h) => `window.${h}()`).join(', ')}`);
      } else {
        say(`  ${name.padEnd(24)} ok`);
      }
    };

    const clickClose = () =>
      evaluate(`(() => {
        const b = document.querySelector('#panel .icon-btn[aria-label="Close panel"]');
        if (!b) return false;
        b.click();
        return true;
      })()`);

    say('close paths (window-closing APIs replaced by counters):');
    await drive('the ✕ button', clickClose);
    await drive('Escape', escape);
    await drive('a click on the floor', () =>
      evaluate(`(() => {
        const c = document.getElementById('floor-canvas');
        if (!c) return false;
        const r = c.getBoundingClientRect();
        c.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + 3, clientY: r.top + 3 }));
        return true;
      })()`),
    );
    await drive('J/K then Escape', async () => {
      await j();
      await k();
      await escape();
    });
    await drive("the palette's close", async () => {
      await evaluate(`(() => {
        const d = document.querySelector('dialog.palette-dialog, dialog#palette, dialog');
        if (d && typeof d.close === 'function') { d.close(); return true; }
        return false;
      })()`);
    });

    // -------------------------------------------------- and once for real
    //
    // The shim proves which API a path calls. Only an unshimmed press proves
    // what the browser then does with it, and it is last because a tab that
    // closes takes the rest of the run with it.
    say('');
    say('the ✕ button again, nothing shimmed:');
    const before = await pageTargets(debugPort);
    let destroyed = false;
    try {
      await evaluate('(delete window.__wp61, location.reload(), true)');
      await sleep(6000);
      await showPanel();
      await clickClose();
      await sleep(1500);
    } catch (err) {
      destroyed = /socket closed|socket failed|cannot send/i.test(String(err));
      if (!destroyed) throw err;
    }
    const after = await pageTargets(debugPort);
    if (destroyed || (before > 0 && after < before)) {
      guilty.push('the ✕ button (page target destroyed)');
      say(`  page targets ${before} -> ${destroyed ? 'socket closed' : after} — THE TAB CLOSED`);
    } else {
      say(`  page targets ${before} -> ${after} — the tab survived`);
    }
  } finally {
    if (browser) await browser.dispose();
    await demo.stop();
  }

  say('');
  if (guilty.length) {
    say(`FAIL · ${guilty.length} close path(s) reached a window-closing API: ${guilty.join(', ')}`);
    return 1;
  }
  say('PASS · no close path reached window.close(), window.open() or history navigation.');
  return 0;
}

process.exitCode = await main();
