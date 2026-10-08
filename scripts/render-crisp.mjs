/**
 * Measure how sharp the floor is on screen, and how big its shadows are.
 *
 *   node scripts/render-crisp.mjs [--population crowded] [--stage 2000x1185]
 *                                 [--dpr 1,1.5,2] [--zoom 1.8] [--json]
 *
 * The floor is one baked bitmap with live vector figures drawn over it, so two
 * things decide whether it reads as crisp: whether a baked pixel reaches the
 * screen as one device pixel, and whether the lighting baked into it is the same
 * size on a HiDPI display as on an ordinary one. This script photographs neither.
 * It asks the page, at a REAL device scale factor, four questions:
 *
 *   resample   device px the floor is drawn at per plan unit, over device px the
 *              bitmap on screen was baked at. 1.000 is one to one.
 *   wall edge  Tenengrad (mean squared Sobel gradient of luminance) of a crop of
 *              the live canvas across an interior wall, against the same crop
 *              of a bitmap baked at exactly the drawn scale and placed on the
 *              device grid. `ideal / shipped` over 1 is sharpness left on the
 *              table.
 *   shadows    the blur and offset the renderer actually set while it baked and
 *              drew one frame, rasterised here and measured: how far each
 *              shadow reaches past its shape, in CSS px on screen.
 *   bake       the bitmap's size in bytes and the median time of three bakes.
 *   backing    whether the canvas's backing store is the size the browser
 *              snapped its box to, in device pixels. Off by one and the whole
 *              canvas — figures and text included — is stretched by a pixel.
 *
 * The device scale factor is Chrome's own `--force-device-scale-factor`, one
 * browser per value. Emulating it over the DevTools Protocol resamples a canvas
 * and reports a 1:1 backing store as soft; a number taken that way is a number
 * about the emulation.
 *
 * Headless Chrome runs without a GPU here, so the bake time is software raster:
 * an upper bound, and comparable only with itself.
 *
 * Nothing is written and nothing real is read: the floor is a demo population
 * on a free port with its own fixture directory, the same one the goldens use.
 */
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { findChrome, hasWebSocket, withChrome } from '../src/cli/chrome.mjs';
import { DEMO_EPOCH } from './demo-args.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
const POPULATION = opt('--population', 'crowded');
const DPRS = String(opt('--dpr', '1,1.5,2'))
  .split(',')
  .map(Number)
  .filter((n) => n > 0);
const ZOOM = Number(opt('--zoom', 1)) || 1;
const stage = /^(\d{3,5})x(\d{3,5})$/.exec(String(opt('--stage', '2000x1185')));
const WIDTH = stage ? Number(stage[1]) : 2000;
const HEIGHT = stage ? Number(stage[2]) : 1185;
const JSON_OUT = argv.includes('--json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (line) => process.stdout.write(`${line}\n`);

/** Start one demo population on a free port; resolves with its URL and a stop. */
function startDemo(population) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(ROOT, 'scripts', 'demo-floor.mjs'), '--population', population, '--port', '0'],
      {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, DECKHQ_NOW: DEMO_EPOCH },
      },
    );
    let out = '';
    let settled = false;
    /** @type {() => Promise<void>} */
    const stop = () =>
      new Promise((done) => {
        if (child.exitCode != null) return done();
        child.once('exit', () => done());
        setTimeout(done, 4000).unref();
        child.kill();
      });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      stop().then(() => reject(new Error(`demo "${population}" did not start:\n${out}`)));
    }, 30_000);
    const onData = (d) => {
      out += d;
      const m = /DeckHQ demo floor\s+(http\S+)/.exec(out);
      if (m && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ url: m[1], stop });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`demo "${population}" exited with ${code}:\n${out}`));
    });
  });
}

/**
 * Everything measured, inside the page, against the scene the product built.
 * Written to run against any revision of the renderer: it reads the bitmap's
 * own resolution where the bake reports one and derives it where it does not.
 */
const MEASURE = `(async (zoom) => {
  const canvas = document.getElementById('floor-canvas');
  const s = canvas.__deckhqScene;
  const bd = await import('/render/backdrop.js');
  const pal = await import('/render/palette.js');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  s.stop();
  if (zoom !== 1) {
    s.setZoom(zoom);
    await sleep(600);
  }
  const plan = s._plan;
  const dpr = s._dpr;
  const scale = s._scale();
  const want = scale * dpr;
  // A bake that takes device pixels per unit says how big it will come out.
  const takesScale = typeof bd.bakeSize === 'function';

  // ---- the shadows the renderer sets during one bake and one frame
  const seen = [];
  const undo = [];
  const watch = (proto, name) => {
    const orig = proto[name];
    proto[name] = function (...a) {
      if (this.shadowBlur > 0 && !/, 0\\)$/.test(String(this.shadowColor))) {
        seen.push({
          live: this.canvas === canvas,
          op: name,
          blur: this.shadowBlur,
          ox: this.shadowOffsetX,
          oy: this.shadowOffsetY,
          fill: String(this.fillStyle),
          color: String(this.shadowColor),
        });
      }
      return orig.apply(this, a);
    };
    undo.push(() => (proto[name] = orig));
  };
  for (const proto of [
    typeof OffscreenCanvasRenderingContext2D === 'function' && OffscreenCanvasRenderingContext2D.prototype,
    CanvasRenderingContext2D.prototype,
  ]) {
    if (!proto) continue;
    watch(proto, 'fill');
    watch(proto, 'fillRect');
  }
  s.repaint();
  if (zoom !== 1) await sleep(600);
  s._draw();
  for (const u of undo) u();

  // ---- which bitmap is on screen, and what it was baked at
  const detail = s._detail && s._detail.canvas ? s._detail : null;
  const shown = detail || s._backdrop;
  const ppu = shown.ppu || 14 * Math.max(1, dpr);
  const bitmaps = [s._backdrop, detail].filter(Boolean);
  const bytes = bitmaps.reduce((n, b) => n + b.canvas.width * b.canvas.height * 4, 0);

  const reachOf = (blur, ox) => {
    const size = Math.ceil(240 + 4 * blur + 2 * Math.abs(ox));
    const cv = new OffscreenCanvas(size, 120);
    const x = cv.getContext('2d');
    x.shadowColor = '#000';
    x.shadowBlur = blur;
    x.shadowOffsetX = ox;
    x.fillStyle = '#000';
    x.fillRect(20, 20, 100, 80);
    const row = x.getImageData(120, 60, size - 120, 1).data;
    // Where the shadow falls to 5 % of its own strength, between two pixels.
    const edge = 12.75;
    let n = 0;
    while (n < size - 120 && row[n * 4 + 3] > edge) n++;
    if (n === 0 || n >= size - 120) return n;
    const a = row[(n - 1) * 4 + 3];
    const b = row[n * 4 + 3];
    return n - 1 + (a - edge) / (a - b) + 0.5;
  };
  const pick = (test) => {
    const hits = seen.filter(test);
    if (!hits.length) return null;
    hits.sort((a, b) => b.blur - a.blur);
    return hits[0];
  };
  const kinds = {
    prop: pick((r) => !r.live && r.ox > 0 && r.fill !== '#000000' && !/60, 52, 44/.test(r.color)),
    slab: pick((r) => !r.live && r.op === 'fill' && r.fill === '#000000'),
    envelope: pick((r) => r.live),
  };
  const shadows = {};
  for (const [name, r] of Object.entries(kinds)) {
    if (!r) continue;
    // A baked shadow reaches the screen through the blit, so it is magnified by
    // whatever the blit magnifies the bitmap by; a live one is not.
    const onScreen = r.live ? 1 : want / ppu;
    shadows[name] = {
      blurDevicePx: +r.blur.toFixed(2),
      offsetDevicePx: +r.ox.toFixed(2),
      reachCssPx: +((reachOf(r.blur, r.ox) * onScreen) / dpr).toFixed(2),
    };
  }

  // ---- wall-edge acutance: the live canvas against a bake at the drawn scale
  //
  // The frame is stopped straight after the floor is blitted, so the crops hold
  // the bitmap as the product put it on screen and nothing that is drawn live
  // over it. _lod() is the first thing a frame asks for once the floor is down.
  const cam = s._cameraParams();
  const lod = s._lod;
  s._lod = () => {
    throw new Error('floor only');
  };
  try {
    s._draw();
  } catch {
    s.ctx.restore();
  }
  s._lod = lod;
  const ideal = takesScale ? bd.bakeBackdrop(plan, want) : bd.bakeBackdrop(plan, want / 14);
  const off = new OffscreenCanvas(canvas.width, canvas.height);
  const o = off.getContext('2d');
  o.fillStyle = pal.PALETTE.floorGround;
  o.fillRect(0, 0, off.width, off.height);
  o.drawImage(ideal.canvas, Math.round(cam.panX * dpr), Math.round(cam.panY * dpr));
  const half = Math.round(want);
  const tenengrad = (ctx, x0, y0) => {
    const n = half * 2;
    const px = ctx.getImageData(x0, y0, n, n).data;
    const L = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) {
      L[i] = 0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2];
    }
    let sum = 0;
    for (let y = 1; y < n - 1; y++) {
      for (let x = 1; x < n - 1; x++) {
        const i = y * n + x;
        const gx = L[i - n + 1] + 2 * L[i + 1] + L[i + n + 1] - L[i - n - 1] - 2 * L[i - 1] - L[i + n - 1];
        const gy = L[i + n - 1] + 2 * L[i + n] + L[i + n + 1] - L[i - n - 1] - 2 * L[i - n] - L[i - n + 1];
        sum += gx * gx + gy * gy;
      }
    }
    return sum / ((n - 2) * (n - 2));
  };
  // Every interior wall, sampled along its length and clear of its door.
  const points = [];
  for (const w of plan.walls || []) {
    if (w.kind === 'exterior') continue;
    const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
    for (let d = 3; d < len - 3; d += 6) {
      if (w.door && Math.abs(d - w.door.at) < w.door.width / 2 + 2.5) continue;
      points.push({ x: w.x1 + ((w.x2 - w.x1) * d) / len, y: w.y1 + ((w.y2 - w.y1) * d) / len });
    }
  }
  let shipped = 0;
  let best = 0;
  let crops = 0;
  for (const p of points) {
    const x0 = Math.round((cam.panX + p.x * scale) * dpr) - half;
    const y0 = Math.round((cam.panY + p.y * scale) * dpr) - half;
    if (x0 < 0 || y0 < 0 || x0 + half * 2 > canvas.width || y0 + half * 2 > canvas.height) continue;
    shipped += tenengrad(s.ctx, x0, y0);
    best += tenengrad(o, x0, y0);
    crops++;
  }
  const edge = crops
    ? {
        crops,
        shipped: Math.round(shipped / crops),
        ideal: Math.round(best / crops),
        idealOverShipped: +(best / shipped).toFixed(3),
      }
    : null;
  s._draw();

  // ---- is the backing store the box the browser snapped the canvas to?
  const deviceBox = await new Promise((resolve) => {
    const ro = new ResizeObserver((entries) => {
      ro.disconnect();
      const b = entries[0].devicePixelContentBoxSize;
      resolve(b ? [b[0].inlineSize, b[0].blockSize] : null);
    });
    try {
      ro.observe(canvas, { box: 'device-pixel-content-box' });
    } catch {
      resolve(null);
    }
  });

  // ---- what a bake costs
  const times = [];
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    const baked = takesScale ? bd.bakeBackdrop(plan, s._backdrop.ppu) : bd.bakeBackdrop(plan, dpr);
    // A canvas records what it is told and rasters when somebody looks; reading
    // one pixel back is what makes this the time of a bake and not of a list.
    baked.canvas.getContext('2d').getImageData(0, 0, 1, 1);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);

  return {
    devicePixelRatio: window.devicePixelRatio,
    zoom: s.zoom,
    agents: [...s._runtime.all()].length,
    canvas: [canvas.width, canvas.height],
    deviceBox,
    backingIsDeviceBox: deviceBox
      ? deviceBox[0] === canvas.width && deviceBox[1] === canvas.height
      : null,
    drawnCssPxPerUnit: +scale.toFixed(4),
    neededDevicePxPerUnit: +want.toFixed(4),
    bakedDevicePxPerUnit: +ppu.toFixed(4),
    resample: +(want / ppu).toFixed(4),
    bitmap: bitmaps.map((b) => [b.canvas.width, b.canvas.height]),
    bitmapMB: +(bytes / 1048576).toFixed(1),
    bakeMs: Math.round(times[1]),
    edge,
    shadows,
  };
})`;

/** Wait until the floor is connected and its population has held still. */
async function waitForFloor(client) {
  const deadline = Date.now() + 30_000;
  let last = null;
  let stable = 0;
  while (Date.now() < deadline) {
    const { result } = await client.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const c = document.getElementById('floor-canvas');
        const s = c && c.__deckhqScene;
        if (!s || !s._plan) return null;
        const conn = document.getElementById('connection-status');
        const layer = document.getElementById('coach-layer');
        return { agents: [...s._runtime.all()].length, ok: !!(conn && conn.hidden) && !(layer && !layer.hidden) };
      })()`,
    });
    const state = result.value;
    if (state && state.ok) {
      stable = last !== null && state.agents === last ? stable + 1 : 0;
      last = state.agents;
      if (stable >= 4) return sleep(1200);
    }
    await sleep(250);
  }
  throw new Error('the floor did not settle');
}

if (!hasWebSocket()) {
  say(`render-crisp: needs Node 22 or newer for its WebSocket client (got ${process.version}).`);
  process.exit(0);
}
const chromePath = findChrome();
if (!chromePath) {
  say('render-crisp: no Chrome on this machine; nothing measured.');
  process.exit(0);
}

const demo = await startDemo(POPULATION);
/** @type {any[]} */
const rows = [];
try {
  for (const dpr of DPRS) {
    const row = await withChrome(
      {
        chromePath,
        width: WIDTH,
        height: HEIGHT,
        // A real ratio, set on the browser itself (`withChrome`).
        deviceScaleFactor: dpr,
        extraArgs: ['--force-color-profile=srgb', '--disable-lcd-text'],
      },
      async (client) => {
        await client.send('Emulation.setEmulatedMedia', {
          features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
        });
        await client.send('Page.navigate', { url: demo.url });
        await waitForFloor(client);
        const { result, exceptionDetails } = await client.send('Runtime.evaluate', {
          expression: `${MEASURE}(${ZOOM})`,
          awaitPromise: true,
          returnByValue: true,
        });
        await client.send('Page.navigate', { url: 'about:blank' }).catch(() => {});
        if (exceptionDetails) {
          throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
        }
        return result.value;
      },
    );
    rows.push(row);
    if (!JSON_OUT) {
      const e = row.edge || {};
      const sh = Object.entries(row.shadows)
        .map(([k, v]) => `${k} ${v.reachCssPx}`)
        .join('  ');
      say(
        `dpr ${String(row.devicePixelRatio).padEnd(4)} zoom ${row.zoom}  ` +
          `drawn ${row.neededDevicePxPerUnit} baked ${row.bakedDevicePxPerUnit} dev px/unit  ` +
          `resample ${row.resample}  wall ideal/shipped ${e.idealOverShipped}  ` +
          `bitmap ${row.bitmapMB} MB  bake ${row.bakeMs} ms  backing 1:1 ${row.backingIsDeviceBox}  shadow reach css px: ${sh}`,
      );
    }
  }
} finally {
  await demo.stop();
}
if (JSON_OUT)
  say(JSON.stringify({ population: POPULATION, stage: [WIDTH, HEIGHT], rows }, null, 2));
