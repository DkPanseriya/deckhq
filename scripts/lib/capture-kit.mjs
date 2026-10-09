/**
 * What a capture of the demo floor needs beyond one whole-window screenshot.
 *
 * `capture-floor.mjs` photographs the window and `capture-hero.mjs` records the
 * canvas in real time. The pictures for a post want three more things, and each
 * of them is here once so that no recipe has to reinvent it:
 *
 *   1. A CLOSE CROP THAT IS STILL SHARP. The floor has its own magnification
 *      (Ctrl + wheel, up to 2.5 times) and Chrome has a real device pixel
 *      ratio, so a crop is taken by zooming the product and raising the ratio,
 *      never by enlarging pixels afterwards. `zoomTo` turns the product's own
 *      wheel, `shot` clips in CSS pixels and returns device pixels.
 *   2. WHERE THINGS ARE. `geometry` reads the plan the scene is drawing and
 *      says where each room and each robot is on the screen, so a recipe names
 *      a room rather than carrying pixel numbers that die with the next layout.
 *   3. MOTION THAT CAN BE PHOTOGRAPHED FRAME BY FRAME. A screenshot at twice
 *      the size costs a third of a second, so a real-time recording at that
 *      size is three frames a second. `record` runs the floor on a clock that
 *      moves one frame at a time instead: the daemon's own pinned clock
 *      (`DECKHQ_NOW`, stepped by `demo-floor-stepped.mjs`), the page's copy of
 *      it (`public/clock.js`), and the page's frame pacing (`VIRTUAL_CLOCK`).
 *      Nothing in the product is changed and no pixel is drawn by anything but
 *      the product: the floor is told what time it is, which is what a clock
 *      does, and what happens on it is a real hook posted to the real endpoint.
 *
 * Demo floors only. No dependencies: Chrome is `src/cli/chrome.mjs`, PNG is
 * `lib/png.mjs`, GIF is `gif-encoder.mjs`.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { findChrome, pathToFileUrl, withChrome } from '../../src/cli/chrome.mjs';
import { buildPalette, encodeGif, indexPixels, Q } from '../gif-encoder.mjs';
import { boxDownscale, cropImage, decodePng, encodePng } from './png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEMO_SCRIPT = path.join(ROOT, 'scripts', 'demo-floor.mjs');
const STEPPED_SCRIPT = path.join(ROOT, 'scripts', 'demo-floor-stepped.mjs');

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// -------------------------------------------------------------------- demo

/**
 * Start one demo population as a child process, on a port the OS picks.
 *
 * `pinned` fixes the clock at an instant (`DECKHQ_NOW`), which is what a still
 * wants: every age on the floor is then a property of the fixture. A recording
 * leaves it unpinned, because a pinned clock is a stopped animation.
 *
 * `tmp` moves the fixture: the demo builds its fake machine under the system
 * temp directory, and a capture run that must leave nothing outside its own
 * folder points that somewhere it owns.
 *
 * `stepped` starts `demo-floor-stepped.mjs` instead, whose pinned clock moves
 * when `setNow` says so: the daemon half of a recording's clock.
 *
 * @param {{population?:string, theme?:string, pinned?:string|null, tmp?:string,
 *          stepped?:boolean}} opts
 * @returns {Promise<{url:string, root:string, stop:() => Promise<void>,
 *   setNow:(ms:number) => Promise<void>}>}
 */
export function startDemo(opts = {}) {
  const { population = 'demo', theme = 'default', pinned = null, tmp = '', stepped = false } = opts;
  const env = { ...process.env };
  delete env.DECKHQ_NOW;
  if (pinned) env.DECKHQ_NOW = pinned;
  if (tmp) {
    fs.mkdirSync(tmp, { recursive: true });
    env.TEMP = tmp;
    env.TMP = tmp;
    env.TMPDIR = tmp;
  }
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [stepped ? STEPPED_SCRIPT : DEMO_SCRIPT, '--population', population, '--theme', theme, '--port', '0'],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe', ...(stepped ? ['ipc'] : [])], env },
    );
    let out = '';
    let settled = false;
    /** Tell the stepped daemon what time it is, and wait until it has heard. */
    const setNow = (ms) =>
      new Promise((heard, failed) => {
        if (!stepped) return failed(new Error('this demo floor was not started stepped'));
        child.once('message', () => heard());
        child.send({ now: new Date(ms).toISOString() });
      });
    const stop = () =>
      new Promise((done) => {
        if (child.exitCode != null) return done();
        child.once('exit', () => done());
        try {
          child.kill();
        } catch {
          done();
        }
        setTimeout(done, 5000).unref();
      }).then(() => {
        // A killed demo cannot tidy its own fixture, so its caller does.
        const m = /fixture:\s+(\S.*)/.exec(out);
        if (m) fs.rmSync(m[1].trim(), { recursive: true, force: true, maxRetries: 5 });
      });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      stop().then(() => reject(new Error(`demo "${population}" did not start:\n${out}`)));
    }, 30_000);
    const onData = (d) => {
      out += d;
      const url = /DeckHQ demo floor\s+(http\S+)/.exec(out);
      const fixture = /fixture:\s+(\S.*)/.exec(out);
      if (url && fixture && /Ctrl-C to stop/.test(out) && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ url: url[1], root: fixture[1].trim(), stop, setNow });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`demo "${population}" exited with ${code}:\n${out}`));
    });
  });
}

/** POST one hook event to a demo floor, the way the installed hook command would. */
export function postHook(url, body) {
  const { hostname, port } = new URL(url);
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify({ runtime: 'claude-code', ...body }));
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

// ------------------------------------------------------------- virtual time

/**
 * Installed before the document's own scripts run. Real time until `freeze()`.
 * After it, time moves only in `tick(ms)`, and each tick runs the animation
 * frames that were waiting, once, with the new time.
 *
 * TWO CLOCKS, because the floor has two (`public/render/scene-agent.js`). The
 * FRAME clock is `performance.now()` and `requestAnimationFrame`: it paces a
 * walk, and it is replaced here. The ANIMATION clock is `public/clock.js`, the
 * daemon's pinned instant, and it is not replaced: `tick` hands that module the
 * next instant through its own `adoptSnapshotClock`, exactly as a snapshot from
 * a daemon whose `DECKHQ_NOW` had moved would. `freeze` answers with the
 * instant it started from, so the caller can keep the daemon on the same one.
 */
export const VIRTUAL_CLOCK = `(() => {
  const realPerf = performance.now.bind(performance);
  const realRaf = window.requestAnimationFrame.bind(window);
  const realCaf = window.cancelAnimationFrame.bind(window);
  const clock = { frozen: false, base: 0, elapsed: 0, perf: 0, waiting: new Map(), next: 1 };
  performance.now = () => (clock.frozen ? clock.perf : realPerf());
  window.requestAnimationFrame = (cb) => {
    if (!clock.frozen) return realRaf(cb);
    const id = 1e9 + clock.next++;
    clock.waiting.set(id, cb);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    if (!clock.waiting.delete(id)) realCaf(id);
  };
  clock.freeze = async () => {
    clock.product = await import('/clock.js');
    if (!clock.product.isPinned()) throw new Error('the daemon clock is not pinned');
    clock.base = clock.product.now();
    clock.perf = realPerf();
    clock.frozen = true;
    return clock.base;
  };
  clock.tick = (ms) => {
    clock.elapsed += ms;
    clock.perf += ms;
    clock.product.adoptSnapshotClock({ now: Math.round(clock.base + clock.elapsed), nowFixed: true });
    const due = [...clock.waiting.values()];
    clock.waiting.clear();
    for (const cb of due) cb(clock.perf);
    return due.length;
  };
  window.__captureClock = clock;
})();`;

// ------------------------------------------------------------------- stage

/** Read by `geometry`: rooms and robots, in CSS pixels of the page. */
const GEOMETRY = `(() => {
  const c = document.getElementById('floor-canvas');
  const s = c && c.__deckhqScene;
  if (!s || !s._plan) return null;
  const r = c.getBoundingClientRect();
  const cam = s._cameraParams();
  const k = cam.zoom * cam.U;
  const sx = (x) => r.x + cam.panX + x * k;
  const sy = (y) => r.y + cam.panY + y * k;
  return {
    canvas: { x: r.x, y: r.y, w: r.width, h: r.height },
    unit: k,
    zoom: s.zoom,
    dpr: devicePixelRatio,
    floor: { x: sx(0), y: sy(0), w: s._plan.width * k, h: s._plan.height * k },
    rooms: s._plan.rooms.map((room) => ({
      name: room.name || room.id, kind: room.kind,
      x: sx(room.x), y: sy(room.y), w: room.w * k, h: room.h * k,
    })),
    agents: [...s._runtime.all()].map((rec) => ({
      id: rec.agent.id, name: rec.agent.label, title: rec.agent.title,
      state: rec.agent.activityState, junior: !!rec.agent.subagent,
      project: rec.agent.projectName, placement: rec.placement, clip: rec.clip,
      moving: rec.path.length > 0, x: sx(rec.x), y: sy(rec.y),
    })),
    banner: !document.getElementById('degraded-banner').hidden,
    connected: document.getElementById('connection-status').hidden,
  };
})()`;

/**
 * Open a headless Chrome at a REAL device pixel ratio and hand `fn` a stage.
 *
 * @param {{width:number, height:number, dpr?:number, reduced?:boolean, virtual?:boolean}} opts
 * @param {(stage: any) => Promise<any>} fn
 */
export async function withStage(opts, fn) {
  const { width, height, dpr = 2, reduced = true, virtual = false } = opts;
  const chromePath = findChrome();
  if (!chromePath) throw new Error('No Chrome or Edge found. Set CHROME_PATH and try again.');
  return withChrome(
    {
      chromePath,
      width,
      height,
      deviceScaleFactor: dpr,
      // The goldens' three: one colour profile, greyscale text, no hinting.
      extraArgs: ['--force-color-profile=srgb', '--disable-lcd-text', '--font-render-hinting=none'],
    },
    async (client) => {
      const evaluate = async (expression) => {
        const { result, exceptionDetails } = await client.send('Runtime.evaluate', {
          expression,
          returnByValue: true,
          awaitPromise: true,
        });
        if (exceptionDetails) {
          throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
        }
        return result.value;
      };
      await client.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }],
      });
      if (virtual) {
        await client.send('Page.addScriptToEvaluateOnNewDocument', { source: VIRTUAL_CLOCK });
      }
      const geometry = () => evaluate(GEOMETRY);
      const stage = {
        client,
        evaluate,
        geometry,
        width,
        height,
        dpr,
        /** Navigate, then wait until the floor is connected and its head count has held still. */
        async open(url, settleMs = 1500) {
          await client.send('Page.navigate', { url });
          const deadline = Date.now() + 30_000;
          let last = -1;
          let held = 0;
          while (Date.now() < deadline) {
            const g = await geometry().catch(() => null);
            if (g && g.connected) {
              held = g.agents.length === last ? held + 1 : 0;
              last = g.agents.length;
              if (held >= 4) {
                await sleep(settleMs);
                return geometry();
              }
            }
            await sleep(250);
          }
          throw new Error(`the floor at ${url} did not settle`);
        },
        /** Where one element of the page is, in CSS pixels, with its ground colour. */
        rect: (selector) =>
          evaluate(`(() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: r.x, y: r.y, w: r.width, h: r.height,
              ground: getComputedStyle(el).backgroundColor };
          })()`),
        /** One key, as a person presses it. */
        async key(key) {
          for (const type of ['rawKeyDown', 'char', 'keyUp']) {
            await client.send('Input.dispatchKeyEvent', { type, text: key, key, unmodifiedText: key });
          }
          await sleep(150);
        },
        /** Move the pointer to a point of the page, in CSS pixels. */
        async pointer(x, y) {
          await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
          await sleep(60);
        },
        /**
         * Turn the floor's own wheel until its magnification is `zoom`, holding
         * the page point `at` still, then wait for the floor to bake at it.
         */
        async zoomTo(zoom, at) {
          for (let i = 0; i < 8; i++) {
            const now = (await geometry()).zoom;
            if (Math.abs(now - zoom) < 0.004) break;
            await client.send('Input.dispatchMouseEvent', {
              type: 'mouseWheel',
              x: at.x,
              y: at.y,
              deltaX: 0,
              deltaY: -Math.log(zoom / now) / 0.001,
              modifiers: 2,
            });
            await sleep(120);
          }
          await sleep(900);
          return geometry();
        },
        /** Pan the magnified floor by a CSS-pixel offset, with the plain wheel. */
        async panBy(dx, dy) {
          const g = await geometry();
          await client.send('Input.dispatchMouseEvent', {
            type: 'mouseWheel',
            x: g.canvas.x + g.canvas.w / 2,
            y: g.canvas.y + g.canvas.h / 2,
            deltaX: -dx,
            deltaY: -dy,
          });
          await sleep(900);
          return geometry();
        },
        /**
         * A screenshot, as decoded RGBA at device pixels. `clip` is in CSS
         * pixels and is snapped outward to whole ones.
         */
        async shot(clip) {
          // The whole window is photographed and the crop is cut out of it
          // here, in device pixels. Chrome's own `clip` is in CSS pixels, and
          // at a ratio such as 1.875 a CSS pixel is not a whole number of
          // device ones: the picture comes back resampled, and one that starts
          // off the page comes back as a picture of somewhere else.
          const { data } = await client.send('Page.captureScreenshot', {
            format: 'png',
            captureBeyondViewport: false,
          });
          const img = decodePng(Buffer.from(data, 'base64'));
          if (!clip) return img;
          const k = img.width / width;
          const x = Math.max(0, Math.round(clip.x * k));
          const y = Math.max(0, Math.round(clip.y * k));
          return cropImage(img, { x, y, w: Math.round(clip.w * k), h: Math.round(clip.h * k) });
        },
        /** `shot`, repeated until two in a row are the same picture. */
        async still(clip) {
          let prev = await stage.shot(clip);
          for (let i = 0; i < 8; i++) {
            await sleep(400);
            const next = await stage.shot(clip);
            if (Buffer.from(next.data).equals(Buffer.from(prev.data))) return next;
            prev = next;
          }
          throw new Error('the floor kept changing between screenshots');
        },
        freeze: () => evaluate('window.__captureClock.freeze()'),
        tick: (ms) => evaluate(`window.__captureClock.tick(${ms})`),
      };
      return fn(stage);
    },
  );
}

// ------------------------------------------------------------------ images

/** Write an RGBA image as a PNG, halved first when it was taken at twice the size. */
export function writePng(file, img, width = img.width) {
  const out = width === img.width ? img : boxDownscale(img, width);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, encodePng(out));
  return out;
}

export function readPng(file) {
  return decodePng(fs.readFileSync(file));
}

/**
 * Lay captures out on a page and photograph the page, at twice the size.
 *
 * For the pictures that are a capture inside a layout: a crop on the studio
 * ground, a header band above a room. `parts` are RGBA images taken at device
 * pixels; each is written beside the page and is available to the HTML as
 * `{{name}}`, a `file:` URL, with `{{name.w}}` and `{{name.h}}` its size in
 * CSS pixels at a ratio of two — so an `<img>` given that size maps one device
 * pixel to one device pixel and nothing is resampled until the final halving.
 * The page loads nothing from the network: no font, no script, no link.
 *
 * @param {{dir:string, name:string, width:number, height:number, html:string,
 *          parts?:Record<string, {width:number, height:number, data:Uint8Array}>}} opts
 * @returns {Promise<{width:number, height:number, data:Uint8Array}>} at 2x
 */
export async function layout(opts) {
  const { dir, name, width, height, parts = {} } = opts;
  fs.mkdirSync(dir, { recursive: true });
  let html = opts.html;
  for (const [key, img] of Object.entries(parts)) {
    const file = path.join(dir, `${name}.${key}.png`);
    fs.writeFileSync(file, encodePng(img));
    html = html
      .replaceAll(`{{${key}.w}}`, String(img.width / 2))
      .replaceAll(`{{${key}.h}}`, String(img.height / 2))
      .replaceAll(`{{${key}}}`, pathToFileUrl(file));
  }
  const page = path.join(dir, `${name}.html`);
  fs.writeFileSync(page, html, 'utf8');
  return withChrome({ chromePath: findChrome(), width, height, scale: 2 }, async (client) => {
    await client.send('Page.navigate', { url: pathToFileUrl(page) });
    await sleep(700);
    const { data } = await client.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    });
    return decodePng(Buffer.from(data, 'base64'));
  });
}

// --------------------------------------------------------------- recordings

/**
 * Record the floor one frame at a time, on a clock that moves only here.
 *
 * Each frame: say what happens now (`events`, each a real hook or a real key),
 * move the daemon's clock and the page's by one frame, let the floor draw, and
 * photograph `clip`. Frames are written to `dir` as PNGs at `width` — a
 * hundred and fifty frames at 1600 x 900 are most of a gigabyte in memory and
 * nothing on disk.
 *
 * @param {any} stage a stage opened with `virtual: true`, on a `stepped` demo
 * @param {{setNow:(ms:number) => Promise<void>}} demo
 * @param {{fps:number, seconds:number, clip:{x:number,y:number,w:number,h:number},
 *   width:number, dir:string, events?:{at:number, run:() => Promise<any>}[],
 *   watch?:(frame:number, seconds:number) => Promise<any>}} opts
 *   `watch` is called after every frame, for a recipe that reports what it saw.
 * @returns {Promise<string[]>} the frame files, in order
 */
export async function record(stage, demo, opts) {
  const { fps, seconds, clip, width, dir, events = [] } = opts;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const base = await stage.freeze();
  const step = 1000 / fps;
  const pending = [...events].sort((a, b) => a.at - b.at);
  const files = [];
  const total = Math.round(fps * seconds);
  for (let i = 0; i < total; i++) {
    while (pending.length && pending[0].at <= i / fps + 1e-9) {
      await pending.shift().run();
      // The floor hears of it over its event stream, in real time.
      await sleep(400);
    }
    await demo.setNow(base + Math.round((i + 1) * step));
    await stage.tick(step);
    const img = await stage.shot(clip);
    const file = path.join(dir, `${String(i).padStart(4, '0')}.png`);
    writePng(file, img, width);
    files.push(file);
    if (opts.watch) await opts.watch(i, (i + 1) / fps);
  }
  return files;
}

/** A frame given as an image or as the PNG it was written to. */
const frameOf = (f) => (typeof f === 'string' ? readPng(f) : f);

/** A grid of frames, so a recording can be reviewed as one still. */
export function contactSheet(frames, cols = 4, cellW = 640) {
  const cells = frames.map((f) => boxDownscale(frameOf(f), cellW));
  const cellH = cells[0].height;
  const rows = Math.ceil(cells.length / cols);
  const gap = 8;
  const width = cols * cellW + (cols + 1) * gap;
  const height = rows * cellH + (rows + 1) * gap;
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([19, 20, 25, 255], i);
  cells.forEach((cell, n) => {
    const ox = gap + (n % cols) * (cellW + gap);
    const oy = gap + Math.floor(n / cols) * (cellH + gap);
    for (let y = 0; y < cellH; y++) {
      data.set(cell.data.subarray(y * cellW * 4, (y + 1) * cellW * 4), ((oy + y) * width + ox) * 4);
    }
  });
  return { width, height, data };
}

/**
 * Encode frames as a looping GIF with one palette, and write the two files
 * that travel with it: `<name>.frames.png`, twelve frames evenly spaced in
 * TIME, and `<name>.txt`, one line.
 *
 * `frames` are images or PNG files; `delays` gives each frame its own length
 * in hundredths of a second, for a recording that holds each picture (the
 * styles). Without it every frame lasts `1 / fps`. `width` halves the frames on
 * the way in, for the smaller copy of a recording that came out too heavy.
 *
 * The palette is cut from sixteen frames spread across the recording rather
 * than from all of them: the floor's colours do not change while somebody
 * walks across it, and all of them at once do not fit in memory.
 *
 * @param {string} file
 * @param {(string|{width:number,height:number,data:Uint8Array})[]} frames
 * @param {number} fps
 * @param {{delays?:number[], width?:number}} [opts]
 */
export function writeGif(file, frames, fps, opts = {}) {
  const load = (f) => {
    const img = frameOf(f);
    return opts.width && opts.width !== img.width ? boxDownscale(img, opts.width) : img;
  };
  const spread = (n) =>
    Array.from({ length: Math.min(n, frames.length) }, (_, i) =>
      Math.round((i * (frames.length - 1)) / Math.max(1, Math.min(n, frames.length) - 1)),
    );
  const { width, height } = load(frames[0]);
  const palette = buildPalette(
    spread(16).map((i) => load(frames[i]).data),
    255,
  );
  const cache = new Int16Array(1 << (3 * Q)).fill(-1);
  const delays = opts.delays || frames.map(() => Math.round(100 / fps));
  const gif = encodeGif({
    width,
    height,
    palette,
    frames: frames.map((f, i) => ({
      indices: indexPixels(load(f).data, palette, cache),
      delayCs: delays[i],
    })),
  });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, gif);

  // Twelve moments evenly spaced in time, each the frame on screen at it.
  const total = delays.reduce((a, b) => a + b, 0);
  const ends = [];
  delays.reduce((sum, d) => (ends.push(sum + d), sum + d), 0);
  const at = (cs) => Math.max(0, ends.findIndex((end) => cs < end));
  const picks = Array.from({ length: 12 }, (_, i) => at((i * (total - delays.at(-1))) / 11));
  const base = file.replace(/\.gif$/, '');
  writePng(`${base}.frames.png`, contactSheet(picks.map((i) => load(frames[i]))));
  const rate = opts.delays ? (frames.length / (total / 100)).toFixed(2) : String(fps);
  fs.writeFileSync(
    `${base}.txt`,
    `${path.basename(file)}: ${(gif.length / 1048576).toFixed(2)} MB (${gif.length} bytes), ` +
      `${width}x${height}, ${frames.length} frames, ${rate} fps, ${(total / 100).toFixed(1)} s\n`,
  );
  return { bytes: gif.length, width, height, frames: frames.length, seconds: total / 100 };
}

export { boxDownscale, cropImage };
