/**
 * Visual regression harness: golden PNGs of the floor, per fixture population.
 *
 * The three worst bugs in this project's history — the rig a quarter-turn out
 * of true (DEVIATIONS §26), the sofa drawn through a wall (§55), chair
 * backrests ninety degrees off (§52) — passed every unit test and were obvious
 * in one screenshot. This script takes that screenshot on purpose, for each
 * population in `scripts/demo-floor.mjs`, and compares it pixel for pixel
 * against a committed golden.
 *
 *   npm run goldens          # regenerate test/goldens/<platform>/*.png
 *   npm run goldens:check    # compare, write diffs to test/goldens/.out/, exit 1 on a mismatch
 *
 *   node scripts/goldens.mjs [--check] [--only NAME] [--settle MS] [--keep]
 *
 * `--keep` writes every capture to test/goldens/.out/, not only the ones that
 * failed; it is how the noise floor below was measured.
 *
 * HOW A CAPTURE IS MADE DETERMINISTIC
 *   - the demo floor is a pure function of the population name (fixed ids,
 *     titles, ages and token counts; no clock, no random source);
 *   - a fixed 1600x1000 viewport at device scale 1;
 *   - `prefers-reduced-motion: reduce` is emulated, which the renderer honours
 *     by drawing one static pose per state, snapping walks to their end point
 *     and stopping the lounge rotation (VISUAL-SPEC §10);
 *   - the page is polled until the SSE stream is connected, the plan exists and
 *     the agent count has held still, then given a settle window;
 *   - two screenshots are taken half a second apart and must be byte-identical
 *     before either is used — a floor that is still moving fails loudly here
 *     instead of quietly producing a golden that can never match again.
 *
 * WHY GOLDENS ARE PER PLATFORM
 *   Text is rasterised by the operating system's fonts and font engine. The
 *   same floor on Windows (Segoe UI, DirectWrite) and Ubuntu (DejaVu or
 *   Liberation, FreeType) differs in every label, so one set of goldens cannot
 *   serve both. `test/goldens/<process.platform>/` holds one set each; a
 *   platform without a set is reported and skipped, never failed, and its
 *   fresh captures are left in `test/goldens/.out/` so CI can hand them back as
 *   an artifact to be committed.
 *
 * TOLERANCE, AND THE NOISE IT WAS MEASURED AGAINST
 *   A pixel differs when any channel moves by more than CHANNEL_TOLERANCE;
 *   a capture fails when more than MAX_DIFF_FRACTION of its pixels differ.
 *   Both numbers come from measurement on one Windows machine, not from taste
 *   (docs/DEVIATIONS.md WP-21 has the table):
 *
 *   - NOISE. Regenerate, then check twice. Each check differs from its golden
 *     by exactly 36 pixels of 1,600,000, always the same 592x2 strip of the
 *     header, always by a single count on one channel, and the direction flips
 *     between runs — a bistable rounding in one blend, not drift. Nothing else
 *     on the floor moves at all. Above a channel tolerance of 4 the noise is
 *     zero pixels.
 *   - SIGNAL. Revert the one line of the rig facing fix (DEVIATIONS §26) and
 *     the check fails on 3 of the 4 populations: reference 1.53%, demo 0.79%,
 *     single 0.074%. `empty` has nobody on the floor, so it correctly still
 *     passes — it is the control, and its capture under the reverted build is
 *     the 36-pixel noise floor and nothing else.
 *
 *   So CHANNEL_TOLERANCE 8 is eight times the noise amplitude of 1 and keeps
 *   91% of the weakest signal, and MAX_DIFF_FRACTION 0.01% (160 pixels) sits
 *   7x under that weakest signal while staying 4x above the raw 36-pixel noise
 *   count — the budget holds even if the tolerance stopped suppressing the
 *   header flip altogether.
 *
 *   What neither number can absorb is a Chrome or OS font update, which moves
 *   every label at once. That is not a defect to be tolerated; regenerate.
 *
 * No dependencies. Chrome is found by `src/cli/chrome.mjs`; the PNG codec and
 * the diff are `scripts/lib/png.mjs`, over `node:zlib`.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { findChrome, hasWebSocket, withChrome } from '../src/cli/chrome.mjs';
import { decodePng, diffImages, encodePng } from './lib/png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};

const CHECK = has('--check');
const ONLY = opt('--only', '');
const SETTLE_MS = Number(opt('--settle', 1500));
/** Write every capture to OUT_DIR, not only the ones that failed. */
const KEEP = has('--keep');

/** Every population `scripts/demo-floor.mjs --population` accepts. */
const POPULATIONS = ['demo', 'empty', 'single', 'reference'];

export const WIDTH = 1600;
export const HEIGHT = 1000;
/**
 * A channel has to move by more than this (of 255) for the pixel to count.
 * 8 is eight times the measured noise amplitude and keeps 91% of the weakest
 * real signal — see TOLERANCE above.
 */
export const CHANNEL_TOLERANCE = 8;
/** More than this fraction of pixels differing fails the capture. */
export const MAX_DIFF_FRACTION = 0.0001; // 0.01%: 160 pixels of 1,600,000

const GOLDENS_ROOT = path.join(ROOT, 'test', 'goldens');
const GOLDENS_DIR = path.join(GOLDENS_ROOT, process.platform);
const OUT_DIR = path.join(GOLDENS_ROOT, '.out', process.platform);

const DEMO_SCRIPT = path.join(ROOT, 'scripts', 'demo-floor.mjs');
const BOOT_TIMEOUT_MS = 30_000;
const READY_TIMEOUT_MS = 30_000;

/** @param {string} line */
const say = (line) => process.stdout.write(`${line}\n`);

// ------------------------------------------------------------------- guards

if (!hasWebSocket()) {
  say(
    `goldens: Node ${process.version} has no WebSocket client; Node 22+ is needed to drive Chrome.`,
  );
  say(CHECK ? 'goldens: SKIPPED (nothing checked).' : 'goldens: cannot regenerate.');
  process.exit(CHECK ? 0 : 1);
}

const chromePath = findChrome();
if (!chromePath) {
  say('goldens: no Chrome or Edge found (set CHROME_PATH to point at one).');
  say(CHECK ? 'goldens: SKIPPED (nothing checked).' : 'goldens: cannot regenerate.');
  process.exit(CHECK ? 0 : 1);
}

const populations = ONLY ? [ONLY] : POPULATIONS;
for (const name of populations) {
  if (!POPULATIONS.includes(name)) {
    say(`goldens: unknown population "${name}"; one of: ${POPULATIONS.join(', ')}`);
    process.exit(2);
  }
}

if (CHECK && !fs.existsSync(GOLDENS_DIR)) {
  say(`goldens: no goldens for ${process.platform} in ${rel(GOLDENS_DIR)}.`);
  say(`goldens: capturing anyway into ${rel(OUT_DIR)} — commit them as the first set with`);
  say(`goldens:   npm run goldens   (on a ${process.platform} machine)`);
}

// ------------------------------------------------------------------ helpers

/** @param {string} p */
function rel(p) {
  return path.relative(ROOT, p).split(path.sep).join('/');
}

/**
 * Start one demo population on a free port and resolve with its URL and a
 * function that stops it. The demo script is run as a child so each
 * population gets its own process environment and fixture directory.
 * @param {string} population
 */
function startDemo(population) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [DEMO_SCRIPT, '--population', population, '--port', '0'],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    let settled = false;
    const stop = () =>
      new Promise((done) => {
        if (child.exitCode != null) return done();
        child.once('exit', () => done());
        child.kill();
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
        resolve({ url: m[1], stop });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    // `close`, not `exit`: on Windows `exit` can fire before the child's stderr
    // has been drained, which reports a crash with an empty message and throws
    // away the one stack trace that would have explained it.
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`demo "${population}" exited with ${code} before it was ready:\n${out}`));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * What the page reports about its own readiness. `null` until the scene
 * exists and has a plan.
 * @param {ReturnType<typeof import('../src/cli/chrome.mjs').connect>} client
 */
async function probe(client) {
  const { result } = await client.send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      const c = document.getElementById('floor-canvas');
      const s = c && c.__deckhqScene;
      if (!s || !s._plan) return null;
      const conn = document.getElementById('connection-status');
      const dlg = document.getElementById('onboarding-dialog');
      return {
        agents: [...s._runtime.all()].length,
        connected: !!(conn && conn.hidden),
        onboarding: !!(dlg && dlg.open),
      };
    })()`,
  });
  return result.value;
}

/**
 * Wait until the floor is connected, has a plan and its agent count has held
 * still for a second, then give it the settle window.
 * @param {ReturnType<typeof import('../src/cli/chrome.mjs').connect>} client
 */
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
  throw new Error(
    `floor did not settle in ${READY_TIMEOUT_MS} ms (last probe: ${JSON.stringify(last)})`,
  );
}

/**
 * Capture until two consecutive screenshots agree byte for byte. A floor that
 * is still changing must not become a golden, and must not be compared to one.
 * @param {ReturnType<typeof import('../src/cli/chrome.mjs').connect>} client
 * @returns {Promise<Buffer>}
 */
async function captureStill(client) {
  const shot = async () => {
    const { data } = await client.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    });
    return Buffer.from(data, 'base64');
  };
  let prev = await shot();
  for (let attempt = 0; attempt < 6; attempt++) {
    await sleep(500);
    const next = await shot();
    if (next.equals(prev)) return next;
    prev = next;
  }
  throw new Error('the floor kept changing between screenshots; is reduced motion being honoured?');
}

/**
 * Compare one capture against its golden; write the actual and a diff image
 * to OUT_DIR when they disagree.
 *
 * `compared` is false when there was no golden to compare against, so the
 * summary can say SKIPPED instead of claiming everything matched.
 * @param {string} name
 * @param {Buffer} actualPng
 * @returns {{ok:boolean, compared:boolean, detail:string}}
 */
function check(name, actualPng) {
  const goldenFile = path.join(GOLDENS_DIR, `${name}.png`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const actualFile = path.join(OUT_DIR, `${name}.actual.png`);

  if (!fs.existsSync(goldenFile)) {
    fs.writeFileSync(actualFile, actualPng);
    const platformHasSet = fs.existsSync(GOLDENS_DIR);
    return {
      // No set at all for this platform is a skip; a hole in an existing set is a failure.
      ok: !platformHasSet,
      compared: false,
      detail: platformHasSet
        ? `no golden at ${rel(goldenFile)} — run \`npm run goldens\` and commit it`
        : `no ${process.platform} goldens; capture left at ${rel(actualFile)}`,
    };
  }

  if (KEEP) fs.writeFileSync(actualFile, actualPng);
  const expected = decodePng(fs.readFileSync(goldenFile));
  const actual = decodePng(actualPng);
  const result = diffImages(expected, actual, { channelTolerance: CHANNEL_TOLERANCE });
  const fraction = result.differing / result.total;
  const pct = `${(fraction * 100).toFixed(3)}%`;
  // The noise floor, reported whether or not the capture passes. See TOLERANCE.
  const noise = `${result.differingAtAll.toLocaleString('en-US')} px moved at all`;

  if (result.sizeMismatch) {
    fs.writeFileSync(actualFile, actualPng);
    return {
      ok: false,
      compared: true,
      detail: `size ${actual.width}x${actual.height}, golden is ${expected.width}x${expected.height}`,
    };
  }
  if (fraction > MAX_DIFF_FRACTION) {
    const diffFile = path.join(OUT_DIR, `${name}.diff.png`);
    fs.writeFileSync(actualFile, actualPng);
    fs.writeFileSync(diffFile, encodePng(result.diff));
    return {
      ok: false,
      compared: true,
      detail: `${result.differing.toLocaleString('en-US')} of ${result.total.toLocaleString('en-US')} px over tolerance (${pct}, budget ${(MAX_DIFF_FRACTION * 100).toFixed(2)}%), ${noise} — see ${rel(diffFile)}`,
    };
  }
  return {
    ok: true,
    compared: true,
    detail: `${result.differing.toLocaleString('en-US')} px over tolerance (${pct} of budget ${(MAX_DIFF_FRACTION * 100).toFixed(2)}%), ${noise}`,
  };
}

// --------------------------------------------------------------------- run

const started = Date.now();
say(
  `goldens: ${CHECK ? 'checking' : 'regenerating'} ${populations.length} population(s) on ${process.platform}, ${WIDTH}x${HEIGHT}, reduced motion, settle ${SETTLE_MS} ms`,
);

const failures = [];
let compared = 0;
await withChrome(
  {
    chromePath,
    width: WIDTH,
    height: HEIGHT,
    scale: 1,
    // Take the machine out of the picture as far as Chrome allows: one colour
    // profile, greyscale text anti-aliasing, no hinting. The last one is the
    // CI runner: a sandbox-less Chrome rendering our own loopback page is fine.
    extraArgs: [
      '--force-color-profile=srgb',
      '--disable-lcd-text',
      '--font-render-hinting=none',
      ...(process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : []),
    ],
  },
  async (client) => {
    await client.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });

    for (const name of populations) {
      const t0 = Date.now();
      // Inside the try, and with one retry: a demo that fails to boot is a
      // tooling flake, and it used to abort the whole run with a stack trace
      // instead of failing its own population. A gate that dies on the third
      // of four captures teaches people to ignore it.
      let demo = null;
      try {
        try {
          demo = await startDemo(name);
        } catch (first) {
          say(`  .... ${name.padEnd(10)} did not boot (${first.message.split('\n')[0]}); retrying`);
          demo = await startDemo(name);
        }
        await client.send('Page.navigate', { url: demo.url });
        const state = await waitForFloor(client);
        const png = await captureStill(client);
        const secs = ((Date.now() - t0) / 1000).toFixed(1);

        if (CHECK) {
          const verdict = check(name, png);
          if (!verdict.ok) failures.push(name);
          if (verdict.compared) compared++;
          say(
            `  ${verdict.ok ? 'ok  ' : 'FAIL'} ${name.padEnd(10)} ${state.agents} agents  ${secs}s  ${verdict.detail}`,
          );
        } else {
          fs.mkdirSync(GOLDENS_DIR, { recursive: true });
          const file = path.join(GOLDENS_DIR, `${name}.png`);
          fs.writeFileSync(file, png);
          const kb = Math.round(png.length / 1024);
          say(
            `  wrote ${name.padEnd(10)} ${state.agents} agents  ${secs}s  ${rel(file)}  ${kb} KB`,
          );
        }
      } catch (err) {
        failures.push(name);
        say(`  FAIL ${name.padEnd(10)} ${err.message}`);
      } finally {
        if (demo) await demo.stop();
      }
    }
  },
);

const total = ((Date.now() - started) / 1000).toFixed(1);
if (failures.length) {
  say(
    `goldens: ${failures.length} of ${populations.length} failed (${failures.join(', ')}) in ${total}s`,
  );
  if (CHECK) say(`goldens: actual captures and diff images are in ${rel(OUT_DIR)}`);
  process.exit(1);
}
if (!CHECK) {
  say(`goldens: regenerated in ${total}s`);
} else if (compared === 0) {
  // Nothing was compared, so nothing is proven — say so rather than printing a
  // green line CI will read as protection it does not have.
  say(`goldens: SKIPPED in ${total}s — no ${process.platform} goldens to compare against.`);
  say(`goldens: the captures in ${rel(OUT_DIR)} are the set to commit.`);
} else {
  const skipped = populations.length - compared;
  say(`goldens: all ${compared} match in ${total}s${skipped ? ` (${skipped} skipped)` : ''}`);
}
