/**
 * Capture the frames for the README's hero GIF from a running demo floor.
 *
 * The GIF has to show the one thing the product does that nothing else does:
 * an agent finishes its turn, stands up, walks out of its room and into your
 * office, and a waiting badge appears over its head. So this points headless
 * Chrome at the demo floor, hides the header so only the floor is in shot,
 * then tells one working agent its turn has ended — through the real
 * `/api/hook` endpoint, exactly as Claude Code's `Stop` hook would — and
 * records the floor at a steady rate while it walks.
 *
 * Recording happens inside the page, not over the DevTools protocol.
 * `Page.captureScreenshot` at 1200×750 costs Chrome ~280 ms per PNG, which
 * caps an external loop at 3–4 fps; a `getImageData` copy of the floor canvas
 * on a 100 ms timer costs a few milliseconds, so the frames are pulled out as
 * PNGs only after the walk is over.
 *
 *   node scripts/demo-floor.mjs --port 4499                # terminal 1
 *   node scripts/capture-hero.mjs --out <frames dir>       # terminal 2
 *   node scripts/gif-encoder.mjs --dir <frames dir> --out docs/media/hero.gif
 *
 * Point it at the demo floor, never at a real one: the output is committed to
 * a public repository. Node 22+, for the same reason as capture-floor.mjs.
 *
 * Dev script only: `scripts/` is not in the published package.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { findChrome, hasWebSocket, withChrome } from '../src/cli/chrome.mjs';

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};

const URL_ = opt('--url', 'http://127.0.0.1:4499/');
const OUT = path.resolve(opt('--out', 'hero-frames'));
const WIDTH = Number(opt('--width', 1200));
const HEIGHT = Number(opt('--height', 750));
/**
 * Long enough that the floor is at rest before recording starts. Agents walk
 * in from the door on first paint, and that ambient motion competes with the
 * one walk this GIF is about — the eye should have exactly one thing to
 * follow.
 */
const SETTLE_MS = Number(opt('--settle', 18000));
/** Seconds of floor to record before the turn ends, and the total length. */
const LEAD_S = Number(opt('--lead', 1.5));
const DURATION_S = Number(opt('--duration', 9));
const FPS = Number(opt('--fps', 10));
/**
 * The agent that finishes. Defaults to demo-floor.mjs's first session: the
 * "Rate limiter for the public API" agent working in orbital-api. The id is
 * `fakeId(1)` from that script, and the cwd is the fixture directory that
 * script builds — it has to match exactly, because the cwd is how a hook
 * event is resolved to a session.
 */
const SESSION_ID = opt('--session-id', '9e3779b1-d3m0-4f00-9a1b-000000000001');
const CWD = opt('--cwd', path.join(os.tmpdir(), 'deckhq-demo', 'code', 'orbital-api'));

if (!hasWebSocket()) {
  throw new Error(
    `This script needs Node 22 or newer for its WebSocket client (got ${process.version}).`,
  );
}
const chromePath = findChrome();
if (!chromePath) throw new Error('No Chrome or Edge found. Set CHROME_PATH and try again.');

/** POST one hook event, the way the installed hook command would. */
function postHook(url, body) {
  const { hostname, port } = new URL(url);
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        host: hostname,
        port,
        path: '/api/hook',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

await withChrome({ chromePath, width: WIDTH, height: HEIGHT, scale: 1 }, async (client) => {
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await client.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.text || 'page script threw');
    return result.value;
  };

  await client.send('Page.navigate', { url: URL_ });
  await sleep(SETTLE_MS);

  // Floor only: dismiss onboarding, hide the header, and let the stage take
  // the whole viewport. The scene's ResizeObserver re-fits to the new box.
  await evaluate(`(() => {
    const layer = document.getElementById('coach-layer');
    if (layer && !layer.hidden) layer.querySelector('.coach-skip')?.click();
    const s = document.createElement('style');
    s.textContent = '#topbar{display:none!important} #tooltip{display:none!important}';
    document.head.appendChild(s);
    return 'ok';
  })()`);
  await sleep(3000);

  // Start the in-page recorder.
  const period = 1000 / FPS;
  const size = await evaluate(`(() => {
    const c = document.getElementById('floor-canvas');
    const ctx = c.getContext('2d');
    const rec = { frames: [], t0: performance.now(), w: c.width, h: c.height };
    rec.timer = setInterval(() => {
      rec.frames.push({ t: performance.now() - rec.t0, img: ctx.getImageData(0, 0, c.width, c.height) });
    }, ${period});
    window.__heroRec = rec;
    return { w: c.width, h: c.height };
  })()`);
  const recStarted = Date.now();

  await sleep(LEAD_S * 1000);
  const hookAt = Date.now();
  const status = await postHook(URL_, {
    session_id: SESSION_ID,
    cwd: CWD,
    hook_event_name: 'Stop',
    runtime: 'claude-code',
  });
  process.stdout.write(`Stop hook posted for ${SESSION_ID} → HTTP ${status}\n`);

  await sleep(DURATION_S * 1000 - (Date.now() - recStarted));
  const count = await evaluate(`(() => {
    const rec = window.__heroRec;
    clearInterval(rec.timer);
    return rec.frames.length;
  })()`);

  // Pull the frames out one at a time as PNGs, now that timing no longer matters.
  const frames = [];
  for (let i = 0; i < count; i++) {
    const { t, png } = await evaluate(`(() => {
      const rec = window.__heroRec;
      const f = rec.frames[${i}];
      const c = document.createElement('canvas');
      c.width = rec.w; c.height = rec.h;
      c.getContext('2d').putImageData(f.img, 0, 0);
      return { t: f.t, png: c.toDataURL('image/png').split(',')[1] };
    })()`);
    const file = `${String(i).padStart(3, '0')}.png`;
    fs.writeFileSync(path.join(OUT, file), Buffer.from(png, 'base64'));
    // Seconds relative to the moment the Stop hook was posted.
    frames.push({ file, t: (recStarted + t - hookAt) / 1000 });
  }
  fs.writeFileSync(
    path.join(OUT, 'frames.json'),
    JSON.stringify(
      { width: size.w, height: size.h, sessionId: SESSION_ID, fps: FPS, frames },
      null,
      2,
    ),
  );
  const span = frames[frames.length - 1].t - frames[0].t || 1;
  process.stdout.write(
    `wrote ${frames.length} frames to ${OUT}  ${size.w}x${size.h}  (${((frames.length - 1) / span).toFixed(1)} fps measured, ${FPS} requested)\n`,
  );
});
