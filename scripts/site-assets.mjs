/**
 * Photograph the site's pictures from the running product — WP-94b.
 *
 *   node scripts/site-assets.mjs                 # every asset in the manifest
 *   node scripts/site-assets.mjs --only queue    # the ones whose name matches
 *   node scripts/site-assets.mjs --survey        # whole frames, uncropped
 *   node scripts/site-assets.mjs --list          # what the manifest declares
 *
 * The owner's review of the site was that its pictures are out of date, that
 * a feature is shown as a whole window when what it is about is one corner of
 * it, and that the page is too heavy to arrive. All three have the same cause:
 * the pictures were taken by hand, one at a time, whenever somebody remembered
 * to. So they are declared instead, in `site/assets.json`, and this takes them.
 *
 * WHAT MAKES A PICTURE HERE REPRODUCIBLE
 *
 *   - the population is a fixture from `scripts/demo-populations.mjs`, so the
 *     names, the room count and the ages are the fixture's, never a real
 *     floor's;
 *   - `DECKHQ_NOW` is pinned to `DEMO_EPOCH` for the daemon, so "2d 7h" is a
 *     property of the fixture and not of the day somebody ran this;
 *   - the stage is one viewport at device scale 2, so a crop rectangle written
 *     in CSS pixels comes out at exactly twice its size — the "displayed size
 *     x 2 and no more" rule the weight budget is built on;
 *   - a still is taken under emulated `prefers-reduced-motion: reduce` and is
 *     re-taken until two screenshots agree byte for byte, so nothing that is
 *     still moving becomes a picture;
 *   - a GIF is taken with motion ON. Either by stepping the scene's pinned
 *     phase (`?phase=`, WP-87) frame by frame, which is exact and repeatable,
 *     or — for the walk, which is driven by the wall clock and not by a clip
 *     phase — by recording the floor canvas on a timer.
 *
 * It borrows its whole method from `scripts/goldens.mjs`: same demo child,
 * same readiness probe, same settle-then-agree capture. It is a separate
 * script rather than a flag on that one because a gate that fails a commit and
 * a tool that writes files into `docs/media/` should not be the same command.
 *
 * Dev script only: `scripts/` is not in the published package. Node 22+.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { findChrome, hasWebSocket, withChrome } from '../src/cli/chrome.mjs';
import { boxDownscale, cropImage, decodePng, encodePng } from './lib/png.mjs';
import { buildPalette, encodeGif, indexPixels, Q } from './gif-encoder.mjs';
import { DEMO_EPOCH } from './demo-args.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(ROOT, 'site', 'assets.json');
const DEMO_SCRIPT = path.join(ROOT, 'scripts', 'demo-floor.mjs');

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
const ONLY = opt('--only', '');
const SURVEY = argv.includes('--survey');
const LIST = argv.includes('--list');
const OUT_DIR = path.resolve(ROOT, opt('--out', SURVEY ? 'site/.survey' : 'docs/media/site'));

/** How long a demo child gets to print its URL, and a floor to settle. */
const BOOT_TIMEOUT_MS = 60_000;
const READY_TIMEOUT_MS = 45_000;
/** The floor's own settling window, after it says it is ready. */
const SETTLE_MS = 3500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (line) => process.stdout.write(`${line}\n`);

/* ------------------------------------------------------------- the manifest */

/**
 * @typedef {object} Asset
 * @property {string} name        the file, without its extension
 * @property {'still'|'gif'} kind
 * @property {string} population  a `scripts/demo-floor.mjs --population`
 * @property {string} [theme]     a theme name; default is the warm office
 * @property {string} [press]     keys to send once the floor has settled
 * @property {string} [click]     a CSS selector to click after those keys
 * @property {number} [phase]     `?phase=`, for a still of a moving floor
 * @property {boolean} [permission] raise a real permission request first
 * @property {{x:number,y:number,w:number,h:number}} [crop] CSS pixels from the
 *   top left of the page. One coordinate system for both kinds: a still is cut
 *   out of the screenshot, and a GIF's frames come off the floor canvas, which
 *   the grabber offsets by the canvas's own position on the page. A GIF can
 *   therefore only show what is on the canvas; a rectangle over the chrome
 *   comes back empty.
 * @property {number} [scale]     device pixel ratio for this capture
 * @property {number} width       the width the file is written at
 * @property {'phase'|'live'} [mode]  how a GIF's frames are taken
 * @property {string} [endTurn]   a project: tell its agent its turn has ended
 * @property {number} [fps]
 * @property {number} [seconds]
 * @property {string} note        what the picture is of, for `--list`
 */

/** @returns {{viewport:{width:number,height:number}, assets: Asset[]}} */
function manifest() {
  const raw = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  for (const asset of raw.assets) {
    if (!asset.name || !asset.kind || !asset.population || !asset.width) {
      throw new Error(`site/assets.json: ${asset.name ?? '(unnamed)'} is missing a required field`);
    }
  }
  return raw;
}

/* ----------------------------------------------------------------- the demo */

/**
 * Start one demo population on a free port — lifted from `scripts/goldens.mjs`
 * so a site picture and a golden are photographs of the same fixture, booted
 * the same way, on the same pinned clock.
 *
 * @param {string} population
 * @param {string} theme
 * @returns {Promise<{url:string, port:number, stop:() => Promise<void>}>}
 */
function startDemo(population, theme = 'default') {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [DEMO_SCRIPT, '--population', population, '--theme', theme, '--port', '0'],
      {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, DECKHQ_NOW: DEMO_EPOCH },
      },
    );
    let out = '';
    let settled = false;
    const stop = () =>
      new Promise((done) => {
        if (child.exitCode != null) return done();
        let finished = false;
        const end = () => {
          if (finished) return;
          finished = true;
          clearTimeout(hard);
          clearTimeout(giveUp);
          done();
        };
        child.once('exit', end);
        const hard = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            /* already gone */
          }
        }, 3000);
        const giveUp = setTimeout(end, 8000);
        hard.unref?.();
        giveUp.unref?.();
        try {
          child.kill();
        } catch {
          end();
        }
      });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      stop().then(() => reject(new Error(`demo "${population}" did not start in time:\n${out}`)));
    }, BOOT_TIMEOUT_MS);
    const onData = (d) => {
      out += d;
      const m = /DeckHQ demo floor\s+(http\S+)/.exec(out);
      if (m && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ url: m[1], port: Number(new URL(m[1]).port), stop });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`demo "${population}" exited with ${code} before it was ready:\n${out}`));
    });
  });
}

/**
 * Raise one real permission request against the running demo, the way the
 * runtime's `PermissionRequest` hook does — `scripts/fake-permission-client.mjs`
 * is the caller, and the route, the hold, the registry and the card are the
 * product's own. The child holds the socket open waiting for a decision, which
 * is exactly what keeps the card on screen for the photograph.
 *
 * @param {number} port
 * @returns {{stop: () => void}}
 */
function raisePermission(port) {
  const child = spawn(
    process.execPath,
    [
      path.join(ROOT, 'scripts', 'fake-permission-client.mjs'),
      '--port',
      String(port),
      '--tool',
      'Bash',
      '--input',
      'rm -rf build',
    ],
    { cwd: ROOT, stdio: 'ignore' },
  );
  return {
    stop: () => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
    },
  };
}

/* ---------------------------------------------------------------- the floor */

/** @param {import('../src/cli/chrome.mjs').Client} client */
async function evaluate(client, expression) {
  const { result, exceptionDetails } = await client.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.text || 'page script threw');
  return result.value;
}

/** What the page says about its own readiness. `null` until the scene has a plan. */
async function probe(client) {
  return evaluate(
    client,
    `(() => {
      const c = document.getElementById('floor-canvas');
      const s = c && c.__deckhqScene;
      if (!s || !s._plan) return null;
      const conn = document.getElementById('connection-status');
      const layer = document.getElementById('coach-layer');
      return {
        agents: [...s._runtime.all()].length,
        connected: !!(conn && conn.hidden),
        onboarding: !!(layer && !layer.hidden),
      };
    })()`,
  );
}

/** Wait until the floor is connected, has a plan, and its agent count holds still. */
async function waitForFloor(client) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let last = null;
  let stable = 0;
  while (Date.now() < deadline) {
    const state = await probe(client);
    if (state && state.connected && !state.onboarding) {
      stable = last !== null && state.agents === last ? stable + 1 : 0;
      last = state.agents;
      if (stable >= 4) {
        await sleep(SETTLE_MS);
        return state;
      }
    }
    await sleep(250);
  }
  throw new Error(`the floor did not settle in ${READY_TIMEOUT_MS} ms (last: ${last})`);
}

/**
 * Press keys the way a person would: the app listens for real `keydown`.
 *
 * Two characters are escapes rather than keys, as in `scripts/capture-floor.mjs`,
 * because the two routes a picture needs most are not printable:
 *   `>`  Tab — the floor / deck toggle
 *   `~`  Enter
 */
async function pressKeys(client, keys) {
  for (const key of String(keys)) {
    const isTab = key === '>';
    const isEnter = key === '~';
    const named = isTab ? 'Tab' : isEnter ? 'Enter' : key;
    if (isTab || isEnter) {
      for (const type of ['rawKeyDown', 'keyUp']) {
        await client.send('Input.dispatchKeyEvent', {
          type,
          key: named,
          windowsVirtualKeyCode: isTab ? 9 : 13,
        });
      }
    } else {
      for (const type of ['rawKeyDown', 'char', 'keyUp']) {
        await client.send('Input.dispatchKeyEvent', { type, text: key, key, unmodifiedText: key });
      }
    }
    await sleep(600);
  }
}

/** Screenshot until two in a row agree byte for byte. */
async function captureStill(client) {
  const shot = async () => {
    const { data } = await client.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    });
    return Buffer.from(data, 'base64');
  };
  let prev = await shot();
  for (let attempt = 0; attempt < 8; attempt++) {
    await sleep(400);
    const next = await shot();
    if (next.equals(prev)) return next;
    prev = next;
  }
  throw new Error('the floor kept changing between screenshots');
}

/* ------------------------------------------------------------------ writing */

/**
 * Crop, downscale and write one RGBA image as a PNG, trying every scanline
 * filter and keeping the smallest file — the same trade `site/build.mjs`
 * makes, for the same reason: this runs once and the bytes are downloaded
 * by everybody who opens the page.
 *
 * @param {{width:number,height:number,data:Uint8Array}} img
 * @param {Asset} asset
 * @param {string} file
 */
function writePng(img, asset, file) {
  let out = img;
  if (out.width > asset.width) out = boxDownscale(out, asset.width);
  let best = null;
  for (const filter of [0, 1, 2, 3, 4]) {
    const candidate = encodePng(out, { filter });
    if (!best || candidate.length < best.length) best = candidate;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, best);
  return { width: out.width, height: out.height, bytes: best.length };
}

/**
 * Encode frames into a looping GIF with one global palette.
 *
 * One palette over every frame, not one per frame: a per-frame palette makes
 * the floor shimmer, and the thing this picture has to keep is that the robots
 * stay the colour their state says they are. 255 colours, with the 256th slot
 * reserved for the transparency the encoder uses to send only what moved.
 *
 * @param {{width:number,height:number,data:Uint8Array}[]} images
 * @param {number} fps
 */
function writeGif(images, fps, file) {
  const { width, height } = images[0];
  const palette = buildPalette(
    images.map((i) => i.data),
    255,
  );
  const cache = new Int16Array(1 << (3 * Q)).fill(-1);
  const delayCs = Math.round(100 / fps);
  const frames = images.map((img) => ({ indices: indexPixels(img.data, palette, cache), delayCs }));
  const gif = encodeGif({ width, height, palette, frames });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, gif);
  return { width, height, bytes: gif.length, colours: palette.length, frames: frames.length };
}

/* -------------------------------------------------------------------- frames */

/**
 * Install the in-page frame grabber.
 *
 * A GIF's frames come off the floor canvas rather than through
 * `Page.captureScreenshot`: a screenshot costs Chrome a few hundred
 * milliseconds, which caps an external loop at three or four frames a second,
 * and a `drawImage` into a scratch canvas costs a fraction of one. The grabber
 * also does the crop and the scale, so what crosses the protocol is the
 * finished frame and not a 3200 px screenshot.
 */
async function installGrabber(client) {
  await evaluate(
    client,
    `(() => {
      // One coordinate system for the whole manifest: the rectangle is in CSS
      // pixels from the top left of the PAGE, and this puts it into the
      // canvas's own backing pixels — its offset on the page, then its device
      // pixel ratio.
      window.__deckhqBox = () => {
        const c = document.getElementById('floor-canvas');
        const b = c.getBoundingClientRect();
        return { left: b.left, top: b.top, width: b.width, height: b.height, k: c.width / b.width };
      };
      window.__deckhqGrab = (px, py, w, h, outW) => {
        const c = document.getElementById('floor-canvas');
        const b = c.getBoundingClientRect();
        const k = c.width / b.width;
        const x = px - b.left;
        const y = py - b.top;
        const o = document.createElement('canvas');
        o.width = outW;
        o.height = Math.max(1, Math.round((h * outW) / w));
        const ctx = o.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(c, x * k, y * k, w * k, h * k, 0, 0, o.width, o.height);
        return o.toDataURL('image/png');
      };
      window.__deckhqPhase = (p) => {
        const s = document.getElementById('floor-canvas').__deckhqScene;
        s._phase = p;
        return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      };
      return true;
    })()`,
  );
}

/** One frame off the canvas, as an RGBA image. */
async function grab(client, rect, outWidth) {
  const url = await evaluate(
    client,
    `window.__deckhqGrab(${rect.x}, ${rect.y}, ${rect.w}, ${rect.h}, ${outWidth})`,
  );
  return decodePng(Buffer.from(String(url).split(',')[1], 'base64'));
}

/**
 * The frames of one GIF.
 *
 * `phase` steps WP-87's pinned phase from 0 to 1 across the whole run, so the
 * clip is walked through its own cycle exactly once and the last frame joins
 * the first. Every animation on the floor is pinned to the same phase, which
 * is what makes this repeatable to the pixel and what makes it a loop.
 *
 * `live` lets the wall clock drive and samples on a timer, which is the only
 * way to record the things that are not a clip phase at all — an agent
 * standing up, walking out of its room and into your office.
 *
 * @param {Asset} asset
 */
async function frames(client, asset, scale) {
  const fps = asset.fps ?? 25;
  const count = Math.round(fps * (asset.seconds ?? 4));
  const rect = asset.crop ?? { x: 0, y: 0, w: 1600, h: 1000 };
  // Never enlarge: a frame is written at the width it was drawn at, or less.
  const outWidth = Math.min(asset.width, Math.round(rect.w * scale));
  /** @type {{width:number,height:number,data:Uint8Array}[]} */
  const out = [];
  if ((asset.mode ?? 'phase') === 'phase') {
    for (let i = 0; i < count; i++) {
      await evaluate(client, `window.__deckhqPhase(${(i / count).toFixed(6)})`);
      out.push(await grab(client, rect, outWidth));
    }
    return out;
  }
  // Live. The frames are buffered INSIDE the page on a timer and pulled out
  // afterwards, which is `scripts/capture-hero.mjs`'s trick and the only way
  // to reach 25 fps: a round trip per frame caps an external loop at three or
  // four. `getImageData` of the crop alone is a few milliseconds.
  await evaluate(
    client,
    `(() => {
      const c = document.getElementById('floor-canvas');
      const ctx = c.getContext('2d');
      const b = c.getBoundingClientRect();
      const k = c.width / b.width;
      const r = {
        x: Math.round((${rect.x} - b.left) * k),
        y: Math.round((${rect.y} - b.top) * k),
        w: Math.round(${rect.w} * k),
        h: Math.round(${rect.h} * k),
      };
      const rec = { frames: [], r };
      rec.timer = setInterval(() => {
        rec.frames.push(ctx.getImageData(r.x, r.y, r.w, r.h));
      }, ${(1000 / fps).toFixed(2)});
      window.__deckhqRec = rec;
      return true;
    })()`,
  );
  await sleep((count / fps) * 1000 + 200);
  const taken = await evaluate(
    client,
    `(() => {
      const rec = window.__deckhqRec;
      clearInterval(rec.timer);
      return rec.frames.length;
    })()`,
  );
  for (let i = 0; i < Math.min(taken, count); i++) {
    const url = await evaluate(
      client,
      `(() => {
        const rec = window.__deckhqRec;
        const f = rec.frames[${i}];
        const s = document.createElement('canvas');
        s.width = f.width;
        s.height = f.height;
        s.getContext('2d').putImageData(f, 0, 0);
        const o = document.createElement('canvas');
        o.width = ${outWidth};
        o.height = Math.max(1, Math.round((f.height * ${outWidth}) / f.width));
        const ctx = o.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(s, 0, 0, o.width, o.height);
        return o.toDataURL('image/png');
      })()`,
    );
    out.push(decodePng(Buffer.from(String(url).split(',')[1], 'base64')));
  }
  return out;
}

/**
 * Tell one agent its turn has ended, through the real `/api/hook` endpoint and
 * with the payload Claude Code's `Stop` hook sends — WP-94b, borrowed whole
 * from `scripts/capture-hero.mjs`.
 *
 * This is the one thing on the floor that no clip phase can produce: the agent
 * stands up, walks out of its room, crosses to your office and puts its hand
 * up. The agent is whichever one the daemon lists first in the project the
 * asset names, so the walk is the fixture's and not a chosen one.
 *
 * @param {number} port
 * @param {string} project
 * @returns {Promise<string>} what happened, for the log
 */
async function endTurn(port, project) {
  const state = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json();
  const agents = (state.agents ?? []).filter(
    (a) => !project || String(a.project ?? a.cwd ?? '').includes(project),
  );
  const agent = agents.find((a) => a.state === 'working') ?? agents[0];
  if (!agent) return `no agent in ${project || 'the fixture'}`;
  const id = String(agent.id);
  const response = await fetch(`http://127.0.0.1:${port}/api/hook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: id.includes(':') ? id.slice(id.indexOf(':') + 1) : id,
      cwd: agent.cwd,
      hook_event_name: 'Stop',
      runtime: 'claude-code',
    }),
  });
  return `${agent.name ?? agent.id} finished (HTTP ${response.status})`;
}

/* --------------------------------------------------------------------- main */

if (!hasWebSocket()) {
  throw new Error(`This script needs Node 22 or newer (got ${process.version}).`);
}

const { viewport, assets } = manifest();

if (LIST) {
  for (const asset of assets) {
    say(
      `${asset.name.padEnd(24)} ${asset.kind.padEnd(5)} ${asset.population.padEnd(10)} ` +
        `${String(asset.width).padStart(5)} px  ${asset.note}`,
    );
  }
  process.exit(0);
}

const wanted = assets.filter((a) => !ONLY || a.name.includes(ONLY));
if (wanted.length === 0) throw new Error(`--only ${ONLY} matched nothing`);

const chromePath = findChrome();
if (!chromePath) throw new Error('No Chrome or Edge found. Set CHROME_PATH and try again.');

/** @type {string[]} assets the fixtures could not reach, reported and never faked */
const missed = [];

await withChrome(
  {
    chromePath,
    width: viewport.width,
    height: viewport.height,
    scale: 1,
    extraArgs: ['--force-color-profile=srgb', '--disable-lcd-text', '--font-render-hinting=none'],
  },
  async (client) => {
    for (const asset of wanted) {
      const t0 = Date.now();
      let demo = null;
      let permission = null;
      try {
        demo = await startDemo(asset.population, asset.theme ?? 'default');

        // Device scale 2 for a still: the crop rectangle is written in CSS
        // pixels and comes out at twice its size, which is the most the page
        // is allowed to serve and the least that still looks sharp.
        // Device scale 2 by default. A GIF of a large region says `"scale": 1`
        // instead: its frames are buffered as raw pixels inside the page, and
        // four times the pixels for four times the memory buys nothing once
        // the result is downscaled to the width the page shows.
        const scale = asset.scale ?? (asset.kind === 'gif' ? 1 : 2);
        await client.send('Emulation.setDeviceMetricsOverride', {
          width: viewport.width,
          height: viewport.height,
          deviceScaleFactor: scale,
          mobile: false,
        });
        // A still is a photograph of a state, so motion is off unless the
        // asset pins a phase; a GIF is a photograph of motion, so it is on.
        const reduce = asset.kind !== 'gif' && asset.phase === undefined;
        await client.send('Emulation.setEmulatedMedia', {
          features: [
            { name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' },
          ],
        });

        const query = asset.phase === undefined ? '' : `?phase=${asset.phase}`;
        await client.send('Page.navigate', { url: `${demo.url}${query}` });
        await waitForFloor(client);

        if (asset.permission) {
          permission = raisePermission(demo.port);
          await sleep(2500);
        }
        if (asset.press) {
          await pressKeys(client, asset.press);
          await sleep(SETTLE_MS);
        }
        if (asset.click) {
          const hit = await evaluate(
            client,
            `(() => {
              const el = document.querySelector(${JSON.stringify(asset.click)});
              if (!el) return 'no match';
              el.click();
              return 'clicked';
            })()`,
          );
          if (hit === 'no match') {
            // NEVER FAKED. A crop the fixture cannot reach is reported and
            // left out; a picture of something else with the right caption
            // would be the one defect this whole package exists to remove.
            missed.push(`${asset.name}: the fixture never showed \`${asset.click}\``);
            say(`  MISS ${asset.name.padEnd(22)} no element matched ${asset.click}`);
            continue;
          }
          await sleep(2000);
        }

        if (asset.kind === 'gif') {
          await installGrabber(client);
          if (asset.endTurn !== undefined) {
            say(`       ${await endTurn(demo.port, asset.endTurn)}`);
            // The lead-in: enough for the agent to push its chair back and be
            // on its feet, so the recording opens on a walk rather than on a
            // desk. Shorter than capture-hero.mjs's, because this records the
            // room it leaves and not the whole floor.
            await sleep(700);
          }
          const images = await frames(client, asset, scale);
          const file = path.join(OUT_DIR, `${asset.name}.gif`);
          const r = writeGif(images, asset.fps ?? 25, file);
          say(
            `  ok   ${asset.name.padEnd(22)} ${r.width}x${r.height}  ${r.frames} frames @ ` +
              `${asset.fps ?? 25} fps  ${r.colours} colours  ${(r.bytes / 1024).toFixed(0)} KB  ` +
              `${((Date.now() - t0) / 1000).toFixed(1)}s`,
          );
          continue;
        }

        const png = await captureStill(client);
        let img = decodePng(png);
        if (asset.crop && !SURVEY) {
          img = cropImage(img, {
            x: asset.crop.x * scale,
            y: asset.crop.y * scale,
            w: asset.crop.w * scale,
            h: asset.crop.h * scale,
          });
        }
        const file = path.join(OUT_DIR, `${asset.name}.png`);
        const r = writePng(img, SURVEY ? { ...asset, width: img.width } : asset, file);
        say(
          `  ok   ${asset.name.padEnd(22)} ${r.width}x${r.height}  ` +
            `${(r.bytes / 1024).toFixed(0)} KB  ${((Date.now() - t0) / 1000).toFixed(1)}s`,
        );
      } catch (error) {
        missed.push(`${asset.name}: ${error.message.split('\n')[0]}`);
        say(`  FAIL ${asset.name.padEnd(22)} ${error.message.split('\n')[0]}`);
      } finally {
        permission?.stop();
        // Release the page before the daemon is asked to go: an SSE stream is
        // a request in flight, and the polite order costs one command.
        await client.send('Page.navigate', { url: 'about:blank' }).catch(() => {});
        await demo?.stop();
      }
    }
  },
);

say(`\nsite assets -> ${path.relative(ROOT, OUT_DIR)}`);
if (missed.length) {
  say(`${missed.length} not taken:`);
  for (const line of missed) say(`  - ${line}`);
}
