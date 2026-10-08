/**
 * What one frame of the floor costs, and what it costs to plan one.
 *
 *   node scripts/render-bench.mjs [--stage 2000x1055] [--dpr 1] [--frames 60]
 *                                 [--sizes 20,150,300] [--json]
 *
 * The floor is a baked bitmap with live vector figures over it, redrawn on
 * every animation frame. This script asks the page four questions, at three
 * sizes of floor:
 *
 *   plan      `buildPlan` for that floor: the first call, and a second call with
 *             the same inputs (what a re-plan costs when no geometry moved).
 *   draw      the JavaScript of one `_draw()` — the canvas calls being recorded,
 *             not rastered — as the median of `--frames` frames, with motion on
 *             and the clock stepped 1/60 s between frames so every figure is in
 *             a new pose each time.
 *   calls     the canvas calls in one such frame after warm-up: all of them, and
 *             the ones worth counting on their own (`measureText`, `font =`,
 *             text, `drawImage`, gradients built, fills that cover the canvas).
 *   raster    the same frame forced through with a one-pixel read-back. Headless
 *             Chrome has no GPU here, so this is SOFTWARE raster: an upper bound,
 *             comparable only with itself.
 *   same      the frame drawn the way it is shipped — the ground from its
 *             composed layer, the layout from the one kept — against the same
 *             frame with the ground painted directly and everything measured
 *             again: how many pixels of the canvas differ at all. 0 is the
 *             claim that a kept layer is the picture it replaced. `n/a` on a
 *             revision that has neither.
 *   idle      how many frames the loop draws in two seconds when nothing on the
 *             floor is moving: under `prefers-reduced-motion`, and with motion on
 *             and the clock pinned. `ticks` is how many animation frames the
 *             browser offered in that time. And how many pixels of the canvas
 *             left standing differ from the frame drawn straight afterwards.
 *
 * The three floors are the `large` demo population (150 agents, 40 repos), the
 * first 20 of its senior sessions, and the same population twice over (300
 * agents, 80 repos). Each is given to a second `Scene` on its own canvas inside
 * the product page, built from the product's own modules; the page's own scene
 * is stopped first.
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
const stage = /^(\d{3,5})x(\d{3,5})$/.exec(String(opt('--stage', '2000x1055')));
const WIDTH = stage ? Number(stage[1]) : 2000;
const HEIGHT = stage ? Number(stage[2]) : 1055;
const DPR = Number(opt('--dpr', 1)) || 1;
const FRAMES = Math.max(5, Number(opt('--frames', 60)) || 60);
const SIZES = String(opt('--sizes', '20,150,300'))
  .split(',')
  .map(Number)
  .filter((n) => n === 20 || n === 150 || n === 300);
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
 * Everything measured, inside the page. Written to run against any revision of
 * the renderer: it uses only what a `Scene` has always had.
 */
const MEASURE = `(async (size, stageW, stageH, frames, reducedRun) => {
  const main = document.getElementById('floor-canvas').__deckhqScene;
  main.stop();
  const { Scene } = await import('/render/scene.js');
  const { buildPlan } = await import('/render/plan.js');
  const { LOOK } = await import('/render/look-derive.js');
  const clock = await import('/clock.js');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const median = (list) => {
    const s = [...list].sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : 0;
  };

  // ---- the floor at this size, from the population the page was served
  const base = main._snapshot;
  const twin = (v) => (v == null ? v : String(v) + '~2');
  let snapshot = base;
  if (size === 20) {
    const seniors = base.agents.filter((a) => a.subagent !== true).slice(0, 20);
    const used = new Set(seniors.map((a) => String(a.projectId)));
    snapshot = {
      ...base,
      agents: seniors,
      projects: base.projects.filter((p) => used.has(String(p.id))),
      crews: undefined,
    };
  } else if (size === 300) {
    snapshot = {
      ...base,
      agents: [
        ...base.agents,
        ...base.agents.map((a) => ({
          ...a,
          id: twin(a.id),
          projectId: twin(a.projectId),
          parentId: a.parentId == null ? a.parentId : twin(a.parentId),
        })),
      ],
      projects: [
        ...base.projects,
        ...base.projects.map((p) => ({ ...p, id: twin(p.id), name: String(p.name) + '-2' })),
      ],
      crews: undefined,
    };
  }

  // ---- a second scene on its own canvas
  const canvas = document.createElement('canvas');
  canvas.style.cssText =
    'position:fixed;left:0;top:0;z-index:99999;background:#101418;width:' +
    stageW + 'px;height:' + stageH + 'px';
  document.body.appendChild(canvas);
  await sleep(50);
  const scene = new Scene(canvas, {});
  await sleep(50);

  // ---- plan: cold, then again with the same inputs
  const planOpts = () => ({
    targetAspect: scene._viewW / scene._viewH,
    stage: { w: scene._viewW, h: scene._viewH },
    now: clock.now(),
    goneHomeDays: (snapshot.settings || {}).goneHomeDays,
    agentSize: LOOK.agentSize,
  });
  let t0 = performance.now();
  buildPlan(snapshot.projects, snapshot.agents, planOpts());
  const planColdMs = performance.now() - t0;
  t0 = performance.now();
  buildPlan(snapshot.projects, snapshot.agents, planOpts());
  const planAgainMs = performance.now() - t0;

  t0 = performance.now();
  scene.setState(snapshot);
  const setStateMs = performance.now() - t0;
  const plan = scene._plan;

  // Everybody to their seat: the bench measures a floor at work, not one
  // walking in.
  const pinnedAt = clock.now();
  for (let i = 0; i < 2000; i++) {
    let walking = false;
    for (const rec of scene._runtime.all()) if (rec.path && rec.path.length) walking = true;
    if (!walking) break;
    scene.stepIfPaused(0.25);
  }

  // ---- canvas calls, counted on every 2D context there is
  const counts = {};
  const bump = (k) => { counts[k] = (counts[k] || 0) + 1; };
  const undo = [];
  const protos = [CanvasRenderingContext2D.prototype];
  if (typeof OffscreenCanvasRenderingContext2D !== 'undefined')
    protos.push(OffscreenCanvasRenderingContext2D.prototype);
  const watch = () => {
    for (const proto of protos) {
      for (const name of Object.getOwnPropertyNames(proto)) {
        const d = Object.getOwnPropertyDescriptor(proto, name);
        if (!d || name === 'constructor' || name === 'canvas') continue;
        if (typeof d.value === 'function') {
          const real = d.value;
          Object.defineProperty(proto, name, {
            ...d,
            value: function (...args) {
              bump('calls');
              bump(name);
              if (name === 'fillRect') {
                const big = Math.abs(args[2]) * Math.abs(args[3]) >= 0.9 * stageW * stageH;
                if (big && typeof this.fillStyle !== 'string') bump('fullCanvasGradientFill');
              }
              if (name === 'drawImage') {
                const img = args[0];
                if (img && img.width * img.height >= 0.25 * canvas.width * canvas.height)
                  bump('drawImageLarge');
              }
              return real.apply(this, args);
            },
          });
          undo.push(() => Object.defineProperty(proto, name, d));
        } else if (d.set && (name === 'font' || name === 'fillStyle' || name === 'strokeStyle')) {
          Object.defineProperty(proto, name, {
            ...d,
            set: function (v) { bump(name + '='); return d.set.call(this, v); },
          });
          undo.push(() => Object.defineProperty(proto, name, d));
        }
      }
    }
  };
  const unwatch = () => { while (undo.length) undo.pop()(); };

  // ---- draw: motion on, the clock stepped a frame at a time
  const step = (i) => clock.adoptSnapshotClock({ now: pinnedAt + i * (1000 / 60), nowFixed: true });
  const wasReduced = scene._reduced;
  scene._reduced = false;
  for (let i = 0; i < 5; i++) { step(i); scene._draw(); }
  const drawTimes = [];
  for (let i = 0; i < frames; i++) {
    step(5 + i);
    const t = performance.now();
    scene._draw();
    drawTimes.push(performance.now() - t);
  }
  watch();
  step(5 + frames);
  scene._draw();
  unwatch();
  const calls = { ...counts };

  const rasterTimes = [];
  for (let i = 0; i < Math.min(frames, 20); i++) {
    step(6 + frames + i);
    const t = performance.now();
    scene._draw();
    scene.ctx.getImageData(0, 0, 1, 1);
    rasterTimes.push(performance.now() - t);
  }

  let visible = 0;
  const cam = scene._cameraParams();
  for (const rec of scene._runtime.all()) {
    const x = cam.panX + rec.x * cam.zoom * cam.U;
    const y = cam.panY + rec.y * cam.zoom * cam.U;
    if (x > -60 && x < scene._viewW + 60 && y > -60 && y < scene._viewH + 60) visible++;
  }

  // ---- same: the shipped frame against one with nothing kept
  let differing = null;
  if ('_useGroundLayer' in scene) {
    const pixels = () => scene.ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    clock.adoptSnapshotClock({ now: pinnedAt + 12345, nowFixed: true });
    scene._useGroundLayer = true;
    for (let i = 0; i < 3; i++) scene._draw();
    const kept = pixels();
    const layered = !!(scene._groundLayer && scene._groundLayer.fresh);
    scene._useGroundLayer = false;
    scene._dropGroundLayer();
    if (scene._layoutTape) scene._layoutTape.forget();
    scene._draw();
    const plain = pixels();
    scene._useGroundLayer = true;
    differing = layered ? 0 : -1;
    for (let i = 0; layered && i < kept.length; i += 4) {
      if (kept[i] !== plain[i] || kept[i + 1] !== plain[i + 1] ||
          kept[i + 2] !== plain[i + 2] || kept[i + 3] !== plain[i + 3]) differing++;
    }
  }

  // ---- idle: how many frames the loop draws when nothing moves
  clock.adoptSnapshotClock({ now: pinnedAt, nowFixed: true });
  scene._reduced = reducedRun ? true : false;
  const idle = async () => {
    let draws = 0;
    let ticks = 0;
    const real = scene._draw;
    scene._draw = function () { draws++; return real.call(this); };
    let on = true;
    const tick = () => { if (!on) return; ticks++; requestAnimationFrame(tick); };
    scene.start();
    await sleep(300);
    draws = 0;
    requestAnimationFrame(tick);
    await sleep(2000);
    on = false;
    scene.stop();
    scene._draw = real;
    // What two seconds of frames not drawn left on the canvas, against the
    // frame drawn now: a skipped frame has to have been the same picture.
    const left = scene.ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    scene._draw();
    const fresh = scene.ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let stale = 0;
    for (let i = 0; i < left.length; i += 4) {
      if (left[i] !== fresh[i] || left[i + 1] !== fresh[i + 1] ||
          left[i + 2] !== fresh[i + 2] || left[i + 3] !== fresh[i + 3]) stale++;
    }
    return { draws, ticks, stale };
  };
  const idleResult = await idle();
  scene._reduced = wasReduced;

  const out = {
    size,
    agents: snapshot.agents.length,
    projects: snapshot.projects.length,
    figures: visible,
    rooms: plan ? plan.rooms.length : 0,
    scale: +scene._scale().toFixed(2),
    lod: scene._lod(),
    dpr: scene._dpr,
    canvas: [canvas.width, canvas.height],
    planHash: plan && plan.hash !== undefined ? plan.hash : null,
    planColdMs: +planColdMs.toFixed(1),
    planAgainMs: +planAgainMs.toFixed(1),
    setStateMs: +setStateMs.toFixed(1),
    drawMs: +median(drawTimes).toFixed(2),
    rasterMs: +median(rasterTimes).toFixed(1),
    calls: calls.calls || 0,
    measureText: calls.measureText || 0,
    fontSets: calls['font='] || 0,
    styleSets: (calls['fillStyle='] || 0) + (calls['strokeStyle='] || 0),
    text: (calls.fillText || 0) + (calls.strokeText || 0),
    drawImage: calls.drawImage || 0,
    drawImageLarge: calls.drawImageLarge || 0,
    gradients: (calls.createRadialGradient || 0) + (calls.createLinearGradient || 0),
    fullCanvasGradientFill: calls.fullCanvasGradientFill || 0,
    differing,
    idleStale: idleResult.stale,
    idleDraws: idleResult.draws,
    idleTicks: idleResult.ticks,
  };
  scene.destroy();
  canvas.remove();
  return out;
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
      if (stable >= 4) return sleep(600);
    }
    await sleep(250);
  }
  throw new Error('the floor did not settle');
}

if (!hasWebSocket()) {
  say(`render-bench: needs Node 22 or newer for its WebSocket client (got ${process.version}).`);
  process.exit(0);
}
const chromePath = findChrome();
if (!chromePath) {
  say('render-bench: no Chrome on this machine; nothing measured.');
  process.exit(0);
}

/** One page per measurement, so no floor inherits another's caches. */
async function measure(url, size, reduced) {
  return withChrome(
    {
      chromePath,
      width: WIDTH,
      height: HEIGHT + 130,
      deviceScaleFactor: DPR,
      extraArgs: ['--force-color-profile=srgb', '--disable-lcd-text'],
    },
    async (client) => {
      await client.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
      });
      await client.send('Page.navigate', { url });
      await waitForFloor(client);
      const { result, exceptionDetails } = await client.send('Runtime.evaluate', {
        expression: `${MEASURE}(${size}, ${WIDTH}, ${HEIGHT}, ${FRAMES}, ${reduced})`,
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
}

const demo = await startDemo('large');
/** @type {any[]} */
const rows = [];
try {
  for (const size of SIZES) {
    const row = await measure(demo.url, size, true);
    const pinned = await measure(demo.url, size, false);
    row.idlePinnedDraws = pinned.idleDraws;
    row.idlePinnedTicks = pinned.idleTicks;
    rows.push(row);
  }
} finally {
  await demo.stop();
}

if (JSON_OUT) {
  say(JSON.stringify({ stage: [WIDTH, HEIGHT], dpr: DPR, frames: FRAMES, rows }, null, 2));
} else {
  /** @type {Array<[string, (r: any) => any]>} */
  const cols = [
    ['agents', (r) => r.agents],
    ['figures', (r) => r.figures],
    ['px/unit', (r) => r.scale],
    ['LOD', (r) => `L${r.lod}`],
    ['buildPlan ms', (r) => r.planColdMs],
    ['  again ms', (r) => r.planAgainMs],
    ['_draw JS ms', (r) => r.drawMs],
    ['raster ms (sw)', (r) => r.rasterMs],
    ['canvas calls', (r) => r.calls],
    ['  per figure', (r) => (r.figures ? Math.round(r.calls / r.figures) : 0)],
    ['measureText', (r) => r.measureText],
    ['font =', (r) => r.fontSets],
    ['fill/strokeStyle =', (r) => r.styleSets],
    ['text draws', (r) => r.text],
    ['drawImage', (r) => r.drawImage],
    ['  canvas-sized', (r) => r.drawImageLarge],
    ['gradients built', (r) => r.gradients],
    ['full-canvas gradient fills', (r) => r.fullCanvasGradientFill],
    [
      'px differing, kept vs measured again',
      (r) => (r.differing == null ? 'n/a' : r.differing < 0 ? 'no layer' : r.differing),
    ],
    ['px differing, canvas left idle vs drawn now', (r) => r.idleStale],
    ['idle, reduced: draws/ticks in 2 s', (r) => `${r.idleDraws}/${r.idleTicks}`],
    ['idle, clock pinned: draws/ticks', (r) => `${r.idlePinnedDraws}/${r.idlePinnedTicks}`],
  ];
  say(`render-bench  ${WIDTH}x${HEIGHT} css px, dpr ${DPR}, median of ${FRAMES} frames`);
  const w = Math.max(...cols.map(([k]) => k.length));
  for (const [label, get] of cols) {
    say(`${label.padEnd(w)}  ${rows.map((r) => String(get(r)).padStart(10)).join('')}`);
  }
}
