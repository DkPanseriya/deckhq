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

import { findChrome, hasWebSocket, withChrome } from '../src/cli/chrome.mjs';

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
  },
);
