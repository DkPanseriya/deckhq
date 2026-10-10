/**
 * Photograph the site's pictures from the running product — WP-94b.
 *
 *   node scripts/site-assets.mjs                 # every asset in the manifest
 *   node scripts/site-assets.mjs --only queue    # the ones whose name matches
 *   node scripts/site-assets.mjs --survey        # whole frames, uncropped
 *   node scripts/site-assets.mjs --sheet DIR     # + twelve frames of each loop
 *   node scripts/site-assets.mjs --frames DIR    # + every frame of each loop
 *   node scripts/site-assets.mjs --formats       # + each still as PNG and WebP, weighed
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
 *   - a loop is taken with motion ON, one frame at a time, and written as a
 *     video at sixty frames a second (`lib/site-loop.mjs`, `lib/video.mjs`).
 *     Either by stepping the scene's pinned phase (`?phase=`, WP-87), or — for
 *     the walk, which is driven by the clock and not by a clip phase — by
 *     holding the floor's clock and the daemon's and moving both one frame at
 *     a time. Neither depends on how fast this machine is, and the written
 *     file is played in Chrome and measured before it is reported.
 *
 * WHY NOT A GIF. Its frame delay is in hundredths of a second and a browser
 * treats anything under two of them as ten, so fifty frames a second is the
 * most it can show, in 256 colours. No page of the site and no README shows
 * one of these loops as a GIF, so none is written here.
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
import { boxDownscale, decodePng } from './lib/png.mjs';
import { encodeIndexedPng } from './lib/png-indexed.mjs';
import { VIRTUAL_CLOCK } from './lib/capture-kit.mjs';
import { loopFrames } from './lib/site-loop.mjs';
import { compareFormats, cutCrop, largeWidth, stillScale, writeLarge } from './lib/site-still.mjs';
import { describeVideo, writeVideo } from './lib/video.mjs';
import { DEMO_EPOCH } from './demo-args.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_DEFAULT = path.join(ROOT, 'site', 'assets.json');
const DEMO_SCRIPT = path.join(ROOT, 'scripts', 'demo-floor.mjs');
const STEPPED_SCRIPT = path.join(ROOT, 'scripts', 'demo-floor-stepped.mjs');

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
const ONLY = opt('--only', '');
const MANIFEST = path.resolve(ROOT, opt('--manifest', MANIFEST_DEFAULT));
const SURVEY = argv.includes('--survey');
const SHEET = opt('--sheet', '') ? path.resolve(ROOT, opt('--sheet', '')) : '';
const FRAMES = opt('--frames', '') ? path.resolve(ROOT, opt('--frames', '')) : '';
const FORMATS = argv.includes('--formats');
const LIST = argv.includes('--list');
const OUT_DIR = path.resolve(ROOT, opt('--out', SURVEY ? 'site/.survey' : 'docs/media/site'));

/** How long a demo child gets to print its URL, and a floor to settle. */
const BOOT_TIMEOUT_MS = 60_000;
const READY_TIMEOUT_MS = 45_000;
/** The floor's own settling window, after it says it is ready. */
const SETTLE_MS = 3500;
/** And longer before a walk is recorded: everybody has come in and sat down. */
const WALK_SETTLE_MS = 6000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (line) => process.stdout.write(`${line}\n`);

/* ------------------------------------------------------------- the manifest */

/**
 * @typedef {object} Asset
 * @property {string} name        the file, without its extension
 * @property {'still'|'loop'} kind
 * @property {string} population  a `scripts/demo-floor.mjs --population`
 * @property {string} [theme]     a theme name; default is the warm office
 * @property {string} [press]     keys to send once the floor has settled
 * @property {string} [command]   words to run from the command palette after them
 * @property {string} [click]     a CSS selector to click next, or `text=<label>`
 *   for the button that carries those words
 * @property {string} [after]     keys to send after the click
 * @property {number} [phase]     `?phase=`, for a still of a moving floor
 * @property {boolean} [permission] raise a real permission request first
 * @property {{x:number,y:number,w:number,h:number}} [crop] CSS pixels from the
 *   top left of the page. One coordinate system for both kinds: a still is cut
 *   out of the screenshot, and a loop's frames come off the floor canvas, which
 *   the grabber offsets by the canvas's own position on the page. A loop can
 *   therefore only show what is on the canvas; a rectangle over the chrome
 *   comes back empty.
 * @property {string} [query]     appended to the floor's address: `look=night-lab`,
 *   `scale=large`. That tab only; nothing is saved
 * @property {boolean} [single]   write one file at `width`, with no `@2x` beside it
 * @property {number} [scale]     device pixel ratio for this capture
 * @property {number} width       the width the `@2x` file is written at. The plain
 *   file is half of it. A loop is one video at exactly this width, which is
 *   twice the width a page shows it at, with its first frame beside it
 * @property {'phase'|'live'} [mode]  how a loop's frames are taken
 * @property {string} [endTurn]   a project: tell its agent its turn has ended
 * @property {number} [fps]       frames a second; 60 unless it says otherwise
 * @property {number} [seconds]
 * @property {number} [bitrate]   bits a second for the video
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
 * `stepped` starts `demo-floor-stepped.mjs` instead, whose pinned clock moves
 * when `setNow` says so: the daemon's half of a walk recorded frame by frame.
 *
 * @param {string} population
 * @param {string} theme
 * @param {boolean} [stepped]
 * @returns {Promise<{url:string, port:number, stop:() => Promise<void>,
 *   setNow:(ms:number) => Promise<void>}>}
 */
function startDemo(population, theme = 'default', stepped = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        stepped ? STEPPED_SCRIPT : DEMO_SCRIPT,
        '--population',
        population,
        '--theme',
        theme,
        '--port',
        '0',
      ],
      {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe', ...(stepped ? ['ipc'] : [])],
        env: { ...process.env, DECKHQ_NOW: DEMO_EPOCH },
      },
    );
    /** Tell the stepped daemon what time it is, and wait until it has heard. */
    const setNow = (ms) =>
      new Promise((heard) => {
        child.once('message', () => heard(undefined));
        child.send({ now: new Date(ms).toISOString() });
      });
    let out = '';
    let settled = false;
    /** @type {() => Promise<void>} */
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
        resolve({ url: m[1], port: Number(new URL(m[1]).port), stop, setNow });
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

/** @param {ReturnType<typeof import('../src/cli/chrome.mjs').connect>} client */
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
 * Three characters are escapes rather than keys, as in `scripts/capture-floor.mjs`,
 * because the routes a picture needs most are not printable:
 *   `>`  Tab — the floor / deck toggle
 *   `~`  Enter
 *   `^`  Escape — shut the panel a click was made in
 */
async function pressKeys(client, keys) {
  for (const key of String(keys)) {
    const isTab = key === '>';
    const isEnter = key === '~';
    const isEscape = key === '^';
    const named = isTab ? 'Tab' : isEnter ? 'Enter' : isEscape ? 'Escape' : key;
    if (isTab || isEnter || isEscape) {
      for (const type of ['rawKeyDown', 'keyUp']) {
        await client.send('Input.dispatchKeyEvent', {
          type,
          key: named,
          windowsVirtualKeyCode: isTab ? 9 : isEnter ? 13 : 27,
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

/**
 * Run one command from the palette, the way a person does: the palette's own
 * chord, the words, Enter. `scripts/goldens.mjs` opens the Studio board this
 * way, and no test seam is added for it here either.
 */
async function runCommand(client, words) {
  for (const type of ['rawKeyDown', 'keyUp']) {
    await client.send('Input.dispatchKeyEvent', {
      type,
      key: 'k',
      modifiers: 2,
      windowsVirtualKeyCode: 0,
    });
  }
  await sleep(600);
  await pressKeys(client, `${words}~`);
}

/**
 * Screenshot until two in a row agree byte for byte.
 *
 * `clip` is the crop in CSS pixels. Chrome cuts it out before the picture
 * crosses the protocol, which is what lets a small crop be taken at four
 * device pixels to one without a 6400 px screenshot behind it.
 *
 * @param {{x:number,y:number,w:number,h:number}} [clip]
 */
async function captureStill(client, clip) {
  const shot = async () => {
    const { data } = await client.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
      ...(clip ? { clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h, scale: 1 } } : {}),
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
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (asset.single) {
    const bytes = encodeIndexedPng(out);
    fs.writeFileSync(file, bytes);
    return { width: out.width, height: out.height, bytes: bytes.length, half: 0 };
  }
  // The pair a page's `srcset` names: `name@2x.png` for a dense screen and
  // `name.png`, half its width, for everything else. Both are cut from the
  // same capture, and the small one is resampled from the pixels rather than
  // from the large one's palette.
  const even = out.width % 2 === 0 ? out : boxDownscale(out, out.width - 1);
  const big = encodeIndexedPng(even);
  const small = encodeIndexedPng(boxDownscale(even, even.width / 2));
  fs.writeFileSync(file.replace(/\.png$/, '@2x.png'), big);
  fs.writeFileSync(file, small);
  return { width: even.width, height: even.height, bytes: big.length, half: small.length };
}

/**
 * Twelve frames of a loop on one sheet, four across, for a person to look at.
 *
 * A loop is the one picture here that cannot be checked by opening it: a walk
 * that never left its desk and a walk that crossed the floor are the same
 * first frame. `--sheet DIR` writes this beside nothing the site serves.
 *
 * @param {{base64:string}[]} frames PNGs, in order
 * @param {string} file
 */
function writeSheet(frames, file) {
  const picks = Array.from({ length: 12 }, (_, i) => {
    const frame = frames[Math.floor((i * (frames.length - 1)) / 11)];
    return boxDownscale(decodePng(Buffer.from(frame.base64, 'base64')), 400);
  });
  const { width, height } = picks[0];
  const sheet = { width: width * 4, height: height * 3, data: new Uint8Array(width * height * 48) };
  picks.forEach((frame, i) => {
    const ox = (i % 4) * width;
    const oy = Math.floor(i / 4) * height;
    for (let y = 0; y < height; y++) {
      const row = frame.data.subarray(y * width * 4, (y + 1) * width * 4);
      sheet.data.set(row, ((oy + y) * sheet.width + ox) * 4);
    }
  });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, encodeIndexedPng(sheet));
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
    (a) => !project || String(a.projectId ?? a.project ?? a.cwd ?? '').includes(project),
  );
  // Somebody still at a desk: an agent already in your office has no walk left
  // to make, and a recording of it is two hundred identical frames.
  const agent = agents.find((a) => (a.activityState ?? a.state) === 'working') ?? agents[0];
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
  return `${agent.displayName ?? agent.name ?? agent.id} finished (HTTP ${response.status})`;
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

// `--only hero` is the hero and not also `hero-phone` and `hero-walk`: a name
// in full is that one asset, and anything else is every name containing it.
const exact = assets.filter((a) => a.name === ONLY);
const wanted = exact.length ? exact : assets.filter((a) => !ONLY || a.name.includes(ONLY));
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
      let held = null;
      try {
        // A walk is recorded on a held clock: the daemon's is stepped, and the
        // page's is replaced before any of its own scripts run.
        const live = asset.kind === 'loop' && asset.mode === 'live';
        demo = await startDemo(asset.population, asset.theme ?? 'default', live);
        if (live) {
          held = await client.send('Page.addScriptToEvaluateOnNewDocument', {
            source: VIRTUAL_CLOCK,
          });
        }

        // Device scale 2 by default: the crop rectangle is written in CSS
        // pixels and comes out at twice its size.
        // A picture whose crop is small is taken denser still — three or four
        // device pixels to one — so a 400 px detail fills a 560 px column on
        // a dense screen without being enlarged. A loop is drawn at the whole
        // ratio that covers its width, and scaled down to it in the page.
        // A still that has a third, larger file is drawn at the ratio that
        // makes its crop exactly that wide (`lib/site-still.mjs`).
        const dense = asset.crop ? Math.min(4, Math.ceil(asset.width / asset.crop.w)) : 2;
        const scale =
          asset.scale ?? (asset.kind === 'still' ? stillScale(asset) : Math.max(2, dense));
        await client.send('Emulation.setDeviceMetricsOverride', {
          width: viewport.width,
          height: viewport.height,
          deviceScaleFactor: scale,
          mobile: false,
        });
        // A still is a photograph of a state, so motion is off unless the
        // asset pins a phase; a loop is a photograph of motion, so it is on.
        const reduce = asset.kind !== 'loop' && asset.phase === undefined;
        await client.send('Emulation.setEmulatedMedia', {
          features: [
            { name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' },
          ],
        });

        const params = [
          asset.phase === undefined ? '' : `phase=${asset.phase}`,
          asset.query ?? '',
        ].filter(Boolean);
        const query = params.length ? `?${params.join('&')}` : '';
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
        if (asset.command) {
          await runCommand(client, asset.command);
          await sleep(SETTLE_MS);
        }
        if (asset.click) {
          // `text=Evening` is the button that says so: the Look panel's
          // segments have words on them and no ids.
          const hit = await evaluate(
            client,
            `(() => {
              const sel = ${JSON.stringify(asset.click)};
              const el = sel.startsWith('text=')
                ? [...document.querySelectorAll('button')].find(
                    (b) => b.textContent.trim() === sel.slice(5),
                  )
                : document.querySelector(sel);
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
        if (asset.after) {
          await pressKeys(client, asset.after);
          await sleep(SETTLE_MS);
        }

        if (asset.kind === 'loop') {
          // Everybody walks in from the door on first paint; a walk wants
          // exactly one person moving when it starts.
          if (live) await sleep(WALK_SETTLE_MS);
          const port = demo.port;
          const taken = await loopFrames(client, asset, {
            scale,
            setNow: live ? demo.setNow : undefined,
            // Six tenths of a second in, so the loop opens on the agent at
            // its desk rather than on one already at the door.
            events:
              asset.endTurn === undefined
                ? []
                : [{ at: 0.6, run: () => endTurn(port, asset.endTurn) }],
            say,
          });
          const file = path.join(OUT_DIR, `${asset.name}.mp4`);
          // Its first frame, as a still at both densities like any other: the
          // picture the page holds the box with and plays the video over, and
          // all a reader who asked for reduced motion is shown.
          const first = decodePng(Buffer.from(taken.frames[0].base64, 'base64'));
          writePng(first, asset, file.replace(/\.mp4$/, '.png'));
          if (SHEET) writeSheet(taken.frames, path.join(SHEET, `${asset.name}.frames.png`));
          if (FRAMES) {
            const dir = path.join(FRAMES, asset.name);
            fs.mkdirSync(dir, { recursive: true });
            taken.frames.forEach((frame, i) =>
              fs.writeFileSync(
                path.join(dir, `${String(i).padStart(4, '0')}.png`),
                Buffer.from(frame.base64, 'base64'),
              ),
            );
          }
          const r = await writeVideo(file, taken.frames, taken.fps, {
            width: taken.width,
            height: taken.height,
            bitrate: asset.bitrate,
            // A loop is played from its start and never sought into, and a
            // key frame is the heaviest frame in the file (65 KB of the
            // hero's 653 KB was its second one): the first frame is the only
            // one.
            keyEvery: taken.frames.length,
          });
          say(
            `  ok   ${asset.name.padEnd(22)} ${((Date.now() - t0) / 1000).toFixed(1)}s\n` +
              `       ${describeVideo(r)}`,
          );
          continue;
        }

        // Chrome cuts the crop out itself at a whole ratio. At any other its
        // clip resamples, so the whole window is taken and cut here.
        const clipped = !SURVEY && asset.crop && Number.isInteger(scale);
        const png = await captureStill(client, clipped ? asset.crop : undefined);
        const shot = decodePng(png);
        const img = SURVEY || clipped || !asset.crop ? shot : cutCrop(shot, asset.crop, scale);
        const file = path.join(OUT_DIR, `${asset.name}.png`);
        const r = writePng(
          img,
          SURVEY ? { ...asset, width: img.width, single: true } : asset,
          file,
        );
        // The third file: the capture itself, at the width it was drawn at.
        const large = SURVEY ? 0 : largeWidth(asset);
        const big = large ? await writeLarge(client, img, file.replace(/\.png$/, '@3x')) : null;
        if (FORMATS) say(`       ${await compareFormats(client, img)}`);
        say(
          `  ok   ${asset.name.padEnd(22)} ${r.width}x${r.height}  ` +
            `${(r.bytes / 1024).toFixed(0)} KB` +
            (r.half ? ` + ${(r.half / 1024).toFixed(0)} KB at half` : '') +
            (big ? ` + ${path.basename(big.file)} ${big.width}x${big.height} ${big.said}` : '') +
            `  ${((Date.now() - t0) / 1000).toFixed(1)}s`,
        );
      } catch (error) {
        missed.push(`${asset.name}: ${error.message.split('\n')[0]}`);
        say(`  FAIL ${asset.name.padEnd(22)} ${error.message.split('\n')[0]}`);
      } finally {
        permission?.stop();
        if (held) {
          await client
            .send('Page.removeScriptToEvaluateOnNewDocument', { identifier: held.identifier })
            .catch(() => {});
        }
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
