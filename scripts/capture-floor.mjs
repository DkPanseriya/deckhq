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
 * No dependencies — Node 22+ has a WebSocket client built in. The Chrome
 * launching and CDP plumbing live in `src/cli/chrome.mjs`, shared with
 * `deckhq doctor --capture-proof`; `src/` rather than here because `scripts/`
 * is not published in the npm package.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { connect, findChrome, hasWebSocket, withChrome } from '../src/cli/chrome.mjs';

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
/**
 * Keys to press before capturing, one character each, in order — e.g. `j` to
 * open the review queue panel, or `jjj` to walk three deep into it. The queue
 * is oldest-first and deterministic on the demo fixture, so a sequence is how
 * you aim the shot at one particular agent.
 *
 * Three characters are escapes rather than keys. Two were added for WP-07,
 * because the command palette is opened with a chord and driven with Enter,
 * and the third for WP-10, whose deck is on Tab:
 *   `^`  hold Ctrl for the next key — `^k` is the palette
 *   `~`  Enter
 *   `>`  Tab — the floor ⇄ deck toggle
 * So `^k,~` opens the palette, types the Settings accelerator, and runs it,
 * and `>` alone photographs the deck.
 */
const PRESS = opt('--press', '');
/**
 * A CSS selector to click after the keys have been pressed, for the parts of
 * the interface that have no keyboard route to them — WP-47's file rows,
 * which are disclosure buttons inside the panel. The first match is clicked;
 * a selector that matches nothing is reported and the shot is still taken,
 * because a screenshot of the wrong thing is more useful than none.
 */
const CLICK = opt('--click', '');
/**
 * A CSS selector to bring to the top of its scroller after the click — the
 * panel is a long column and the interesting part of a shot is often below
 * the fold once a diff is open.
 */
const SCROLL = opt('--scroll', '');
/**
 * Leave WP-13's coach marks up instead of skipping them. The one shot that
 * needs this is `docs/media/coach-marks.png`, and a documented flag is a
 * regenerable screenshot where a hand-rolled script is not.
 */
const KEEP_ONBOARDING = argv.includes('--onboarding');
/**
 * Photograph the floating mini-floor (WP-39) instead of the page.
 *
 * Chromium's Document Picture-in-Picture window is its OWN CDP page target —
 * verified on this machine, headless included — so it can be captured
 * directly rather than photographed through the window it floats over. Open it
 * first (`--press p`), then this finds that target by the title
 * `public/minifloor.js` gives its document and shoots it:
 *
 *   node scripts/capture-floor.mjs --url http://127.0.0.1:4499/ \
 *     --press p --pip --out docs/media/mini-floor.png
 *
 * The window's own size is Chrome's to decide — headless gives it a size of
 * its own regardless of what `requestWindow` asked for — so the viewport is
 * forced to `--pip-width x --pip-height`, which default to the size the
 * product actually requests. A screenshot at a size no user will ever see is
 * not evidence of anything.
 */
const PIP = argv.includes('--pip');
const PIP_W = Number(opt('--pip-width', 320));
const PIP_H = Number(opt('--pip-height', 200));
/** Title `public/minifloor.js` sets on the PiP document. */
const PIP_TITLE = 'DeckHQ — your office';

if (!hasWebSocket()) {
  throw new Error(
    `This script needs Node 22 or newer for its WebSocket client (got ${process.version}).`,
  );
}

const chromePath = findChrome();
if (!chromePath) {
  throw new Error('No Chrome or Edge found. Set CHROME_PATH to the executable and try again.');
}

await withChrome(
  { chromePath, width: WIDTH, height: HEIGHT, scale: SCALE, debugPort: DEBUG_PORT },
  async (client) => {
    await client.send('Page.navigate', { url: URL_ });

    // The floor keeps animating forever, so there is no "load complete" to wait
    // for. Give it a fixed settling window instead: enough for the scan, the
    // first SSE snapshot, the backdrop bake and the walk animations to finish.
    await new Promise((r) => setTimeout(r, SETTLE_MS));

    // Skip first-run onboarding if it is showing, so the shot is of the floor.
    // Since WP-13 that is three coach marks in a layer, not a `<dialog>`; the
    // demo fixtures seed `onboarded: true` so this should never fire, and it
    // stays because "should never" is not "cannot".
    if (!KEEP_ONBOARDING) {
      await client.send('Runtime.evaluate', {
        expression: `(() => {
      const layer = document.getElementById('coach-layer');
      if (layer && !layer.hidden) { layer.querySelector('.coach-skip')?.click(); return 'skipped'; }
      return 'not shown';
    })()`,
      });
    }
    await new Promise((r) => setTimeout(r, 1500));

    // Optionally drive the keyboard before the shot — `j` walks the needs-you
    // queue and opens the side panel, which is what shows that the floor is a
    // work surface and not just a picture. Each character is pressed in turn,
    // with a pause between so the panel's own fetches (the conversation, the
    // "what changed" summary) land before the next key moves the selection.
    let ctrl = false;
    for (const key of PRESS) {
      if (key === '^') {
        ctrl = true;
        continue;
      }
      const isEnter = key === '~';
      const isTab = key === '>';
      const named = isEnter ? 'Enter' : isTab ? 'Tab' : key;
      const modifiers = ctrl ? 2 : 0; // CDP: Alt 1, Ctrl 2, Meta 4, Shift 8
      for (const type of ['keyDown', 'keyUp']) {
        await client.send('Input.dispatchKeyEvent', {
          type,
          modifiers,
          key: named,
          // A key held with a modifier produces no text, and neither do Enter
          // and Tab; sending one anyway types a literal character into
          // whatever has focus instead of firing the shortcut.
          text: type === 'keyDown' && !ctrl && !isEnter && !isTab ? key : undefined,
          windowsVirtualKeyCode: isEnter ? 13 : isTab ? 9 : key.toUpperCase().charCodeAt(0),
        });
      }
      ctrl = false;
      await new Promise((r) => setTimeout(r, 2500));
    }

    if (CLICK) {
      const { result } = await client.send('Runtime.evaluate', {
        expression: `(() => {
      const el = document.querySelector(${JSON.stringify(CLICK)});
      if (!el) return 'no match';
      el.click();
      return 'clicked';
    })()`,
      });
      process.stdout.write(`--click ${CLICK}: ${result?.value}\n`);
      await new Promise((r) => setTimeout(r, 2500));
    }

    if (SCROLL) {
      const { result } = await client.send('Runtime.evaluate', {
        expression: `(() => {
      const el = document.querySelector(${JSON.stringify(SCROLL)});
      if (!el) return 'no match';
      el.scrollIntoView({ block: 'start' });
      return 'scrolled';
    })()`,
      });
      process.stdout.write(`--scroll ${SCROLL}: ${result?.value}\n`);
      await new Promise((r) => setTimeout(r, 800));
    }

    let shooter = client;
    let shotW = WIDTH;
    let shotH = HEIGHT;
    if (PIP) {
      const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      const pipTarget = targets.find(
        (t) => t.type === 'page' && t.title === PIP_TITLE && t.webSocketDebuggerUrl,
      );
      if (!pipTarget) {
        throw new Error(
          `--pip: no floating window is open. Did you pass --press p, and is this a Chromium ` +
            `with Document Picture-in-Picture? Targets seen: ${targets
              .filter((t) => t.type === 'page')
              .map((t) => t.title)
              .join(' | ')}`,
        );
      }
      shooter = connect(pipTarget.webSocketDebuggerUrl);
      await shooter.ready;
      await shooter.send('Page.enable');
      await shooter.send('Emulation.setDeviceMetricsOverride', {
        width: PIP_W,
        height: PIP_H,
        deviceScaleFactor: SCALE * 2,
        mobile: false,
      });
      shotW = PIP_W;
      shotH = PIP_H;
      // One settling window for the resize: the mini-floor refits its camera
      // on the next frame, and shooting before that photographs the old one.
      await new Promise((r) => setTimeout(r, 2000));
    }

    const { data } = await shooter.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    });
    if (shooter !== client) shooter.close();

    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, Buffer.from(data, 'base64'));
    const kb = Math.round(fs.statSync(OUT).size / 1024);
    const scale = PIP ? SCALE * 2 : SCALE;
    process.stdout.write(`wrote ${OUT}  ${shotW * scale}x${shotH * scale}  ${kb} KB\n`);
  },
);
