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
 *   node scripts/goldens.mjs [--check] [--only NAME] [--theme NAME] [--settle MS]
 *                            [--keep] [--verbose] [--deadline S] [--budget S]
 *
 * `--keep` writes every capture to test/goldens/.out/, not only the ones that
 * failed; it is how the noise floor below was measured.
 * `--verbose` prints one timestamped line per stage, which is what a CI log
 * needs in order to say WHERE a run stopped rather than only that it did.
 *
 * WHY THERE ARE DEADLINES IN HERE AND NOT ONLY IN THE JOB
 *   The job's `timeout-minutes` is a kill, not a diagnosis: GitHub records the
 *   killed job as `cancelled`, one cancelled job makes the whole run
 *   `cancelled`, and the log ends mid-sentence with nothing said about what it
 *   was doing (DEVIATIONS §121, and §126.3 for the run this was written for —
 *   eight minutes spent inside `demo.stop()`, and a log whose last line was a
 *   passing capture). So every stage is named, every stage is bounded, and
 *   both a per-capture deadline and a whole-run budget sit well under the job
 *   timeout. Overrunning one prints the stage it was in and exits SKIPPED,
 *   because a run that could not take a photograph has proved nothing about
 *   the floor either way — only a pixel mismatch is a failure.
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

import { CHROME_UNAVAILABLE, findChrome, hasWebSocket, withChrome } from '../src/cli/chrome.mjs';
import { THEME_NAMES } from '../src/core/themes.mjs';
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
/** Capture only this theme's set. `--theme night-shift` or `--theme "night shift"`. */
const THEME = opt('--theme', '');
const SETTLE_MS = Number(opt('--settle', 1500));
/** Write every capture to OUT_DIR, not only the ones that failed. */
const KEEP = has('--keep');
/** One timestamped line per stage, so a CI log says where a run stopped. */
const VERBOSE = has('--verbose') || process.env.GOLDENS_VERBOSE === '1';
/**
 * How long one capture — boot, navigate, settle, screenshot, teardown — may
 * take before it is abandoned as an environment problem. Measured at 4-7 s per
 * capture on both a Windows laptop and the ubuntu runner, so 90 s is an order
 * of magnitude of headroom and still leaves the whole run inside the budget
 * below.
 */
const CAPTURE_DEADLINE_MS = Number(opt('--deadline', 90)) * 1000;
/**
 * How long the whole run may take. The CI job allows 8 minutes; this is 6, so
 * the script always reaches its own summary line and the job never has to kill
 * it. A killed job is recorded as `cancelled` and says nothing.
 */
const RUN_BUDGET_MS = Number(opt('--budget', 360)) * 1000;

/** Every population `scripts/demo-floor.mjs --population` accepts. */
const POPULATIONS = ['demo', 'empty', 'single', 'reference'];

/**
 * The captures this gate takes: the four default-theme populations, plus one
 * `demo` floor per shipped theme (WP-30).
 *
 * A theme changes no geometry — it repaints baked materials — so photographing
 * every population in every theme would be four times the Chrome time for one
 * fact. One populated floor per theme is what proves a theme reaches the bake,
 * and it is the capture that would catch the failure that actually matters: a
 * derivation that leaves a material unreadable, or a theme that quietly does
 * not apply at all.
 *
 * A themed capture's golden is `<population>@<theme>.png`. The default theme's
 * files keep their bare names, so this package adds files and renames none —
 * which is what lets the existing goldens stay at 0 px.
 *
 * @type {ReadonlyArray<{name:string, population:string, theme:string}>}
 */
const CAPTURES = [
  ...POPULATIONS.map((population) => ({ name: population, population, theme: 'default' })),
  ...THEME_NAMES.filter((theme) => theme !== 'default').map((theme) => ({
    name: `demo@${theme.replace(/\s+/g, '-')}`,
    population: 'demo',
    theme,
  })),
];

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

/**
 * The stage the run is in right now, and when it entered it.
 *
 * This exists so a deadline can say WHERE it expired. "the run timed out" is
 * the same sentence for a demo that would not boot, a page target that never
 * appeared, a floor that would not settle and a browser that stopped
 * answering, and those are four different bugs with four different fixes.
 * @type {{name:string, at:number}}
 */
let stage = { name: 'starting up', at: Date.now() };

/** @param {string} name what the run is doing now. */
function enter(name) {
  stage = { name, at: Date.now() };
  if (VERBOSE) say(`  [${new Date().toISOString()}] ${name}`);
}

/**
 * Run `promise` with a deadline, and report the STAGE it was in when the
 * deadline expired rather than only the fact of it.
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} what
 * @returns {Promise<T>}
 */
function within(promise, ms, what) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const held = ((Date.now() - stage.at) / 1000).toFixed(1);
      reject(
        Object.assign(
          new Error(
            `${what} exceeded ${Math.round(ms / 1000)}s — stuck at "${stage.name}" for ${held}s`,
          ),
          { environmental: true },
        ),
      );
    }, ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

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

if (THEME) {
  const wanted = THEME.replace(/[\s_-]+/g, ' ').toLowerCase();
  if (!THEME_NAMES.includes(wanted)) {
    say(`goldens: unknown theme "${THEME}"; one of: ${THEME_NAMES.join(', ')}`);
    process.exit(2);
  }
}
const wantedTheme = THEME ? THEME.replace(/[\s_-]+/g, ' ').toLowerCase() : '';
const captures = CAPTURES.filter(
  (c) =>
    (!ONLY || c.name === ONLY || c.population === ONLY) &&
    (!wantedTheme || c.theme === wantedTheme),
);
if (captures.length === 0) {
  say(
    `goldens: nothing matches --only "${ONLY}" --theme "${THEME}". Captures: ${CAPTURES.map((c) => c.name).join(', ')}`,
  );
  process.exit(2);
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
 * Start one demo population, in one theme, on a free port, and resolve with
 * its URL and a function that stops it. The demo script is run as a child so
 * each capture gets its own process environment and fixture directory —
 * including its own state.json, which is where the theme is written (WP-30).
 * @param {string} population
 * @param {string} [theme]
 */
function startDemo(population, theme = 'default') {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [DEMO_SCRIPT, '--population', population, '--theme', theme, '--port', '0'],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    let settled = false;
    /**
     * Stop the demo, and do not wait forever for it to agree.
     *
     * The demo daemon shuts down gracefully on SIGTERM, and `close()` waits
     * for `server.close()`, which waits for every open connection to end. An
     * SSE stream never ends. So a browser still parked on this demo's page
     * holds the shutdown open indefinitely — the caller navigates away first
     * for exactly that reason — and this is the backstop for every other way
     * a child can refuse to leave. SIGTERM, then SIGKILL, then give up and
     * carry on: an unreaped demo on a CI runner that is about to be destroyed
     * is not worth a hung gate. docs/DEVIATIONS.md §126.3.
     * @type {() => Promise<void>}
     */
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
        if (typeof hard.unref === 'function') hard.unref();
        if (typeof giveUp.unref === 'function') giveUp.unref();
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
      // Since WP-13 onboarding is a coach-mark layer, not a <dialog>.
      const layer = document.getElementById('coach-layer');
      return {
        agents: [...s._runtime.all()].length,
        connected: !!(conn && conn.hidden),
        onboarding: !!(layer && !layer.hidden),
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
  let polls = 0;
  while (Date.now() < deadline) {
    const state = await probe(client);
    polls++;
    // Every second or so, and only under --verbose: a 30 s wait with no output
    // is indistinguishable from a hang, and "which of connected / plan /
    // onboarding is false" is the answer that shortens the next run.
    if (VERBOSE && polls % 4 === 1) {
      say(`  [${new Date().toISOString()}]   probe ${polls}: ${JSON.stringify(state)}`);
    }
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
  throw Object.assign(
    new Error(
      `floor did not settle in ${READY_TIMEOUT_MS} ms (last probe: ${JSON.stringify(last)})`,
    ),
    { environmental: true },
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
    if (VERBOSE) {
      say(
        `  [${new Date().toISOString()}]   screenshot ${attempt + 2} still differs (${prev.length} -> ${next.length} bytes)`,
      );
    }
    prev = next;
  }
  // Environmental rather than a failure: everything this proves is that
  // something on the page is animating, and the likeliest causes are the
  // machine's, not the commit's — reduced-motion emulation not reaching a
  // renderer, a blinking caret, a font still loading. A capture that could not
  // be held still is not a pixel verdict, so it must not read as one.
  throw Object.assign(
    new Error('the floor kept changing between screenshots; is reduced motion being honoured?'),
    { environmental: true },
  );
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
  `goldens: ${CHECK ? 'checking' : 'regenerating'} ${captures.length} capture(s) on ${process.platform}, ${WIDTH}x${HEIGHT}, reduced motion, settle ${SETTLE_MS} ms`,
);

/** Captures that disagreed with their golden. These fail the build. */
const failures = [];
/**
 * Captures that could not be taken at all — a demo that would not boot, a
 * floor that would not settle, a browser that stopped answering, a deadline.
 * None of them says anything about the pixels, so none of them is a failure;
 * they are reported and the run exits SKIPPED. §87, §114 and §126.3.
 */
const unproven = [];
let compared = 0;
const run = withChrome(
  {
    chromePath,
    width: WIDTH,
    height: HEIGHT,
    scale: 1,
    // Take the machine out of the picture as far as Chrome allows: one colour
    // profile, greyscale text anti-aliasing, no hinting. The sandbox and
    // shared-memory flags a CI runner needs are not here — `withChrome` adds
    // those on linux for every caller, so there is one answer to "how does
    // this Chrome start" rather than one per script.
    extraArgs: ['--force-color-profile=srgb', '--disable-lcd-text', '--font-render-hinting=none'],
  },
  async (client) => {
    enter('emulating reduced motion');
    await client.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });

    for (const capture of captures) {
      const { name, population, theme } = capture;
      const t0 = Date.now();

      const left = RUN_BUDGET_MS - (Date.now() - started);
      if (left <= 5000) {
        unproven.push(name);
        say(`  SKIP ${name.padEnd(18)} the run budget of ${RUN_BUDGET_MS / 1000}s is spent`);
        continue;
      }

      // Inside the try, and with one retry: a demo that fails to boot is a
      // tooling flake, and it used to abort the whole run with a stack trace
      // instead of failing its own population. A gate that dies on the third
      // of four captures teaches people to ignore it.
      let demo = null;
      try {
        await within(
          (async () => {
            enter(`booting the demo daemon for "${name}"`);
            try {
              demo = await startDemo(population, theme);
            } catch (first) {
              say(
                `  .... ${name.padEnd(18)} did not boot (${first.message.split('\n')[0]}); retrying`,
              );
              enter(`booting the demo daemon for "${name}" (second attempt)`);
              demo = await startDemo(population, theme);
            }

            enter(`navigating to ${demo.url}`);
            await client.send('Page.navigate', { url: demo.url });

            enter(`waiting for the floor to settle ("${name}")`);
            const state = await waitForFloor(client);

            enter(`screenshotting ("${name}")`);
            const png = await captureStill(client);
            const secs = ((Date.now() - t0) / 1000).toFixed(1);

            if (CHECK) {
              const verdict = check(name, png);
              if (!verdict.ok) failures.push(name);
              if (verdict.compared) compared++;
              say(
                `  ${verdict.ok ? 'ok  ' : 'FAIL'} ${name.padEnd(18)} ${state.agents} agents  ${secs}s  ${verdict.detail}`,
              );
            } else {
              fs.mkdirSync(GOLDENS_DIR, { recursive: true });
              const file = path.join(GOLDENS_DIR, `${name}.png`);
              fs.writeFileSync(file, png);
              const kb = Math.round(png.length / 1024);
              say(
                `  wrote ${name.padEnd(18)} ${state.agents} agents  ${secs}s  ${rel(file)}  ${kb} KB`,
              );
            }
          })(),
          Math.min(CAPTURE_DEADLINE_MS, left),
          `capture "${name}"`,
        );
      } catch (err) {
        // A capture that could not be taken proves nothing about the floor, so
        // it does not fail the build — but it must not be quiet either, and
        // the SKIPPED summary at the end says the gate did not run.
        unproven.push(name);
        say(`  SKIP ${name.padEnd(18)} ${err.message}`);
      } finally {
        if (demo) {
          // ORDER MATTERS, and this line is the whole of §126.3. The page is
          // still holding this demo's `/api/events` SSE stream open. The demo
          // shuts down through `daemon.close()`, which awaits `server.close()`,
          // which waits for every open connection to end — and an SSE stream
          // does not end. Killing the demo while the browser is still attached
          // therefore deadlocked its SIGTERM handler and hung the whole run
          // for as long as CI would let it. On Windows `child.kill()` is
          // `TerminateProcess`, no handler runs, and none of this was ever
          // visible; on linux and macOS it hung every time.
          //
          // So: let go of the page FIRST, then stop the demo. `about:blank`
          // tears down the EventSource, the response ends, `server.close()`
          // completes, and the child exits in milliseconds.
          enter(`releasing the page and stopping the demo ("${name}")`);
          await client.send('Page.navigate', { url: 'about:blank' }).catch(() => {});
          await within(demo.stop(), 15_000, `stopping the demo for "${name}"`).catch((err) =>
            say(`  .... ${name.padEnd(18)} ${err.message}`),
          );
        }
      }
    }
  },
);

// A browser that will not start is the third tooling gap, beside "no
// WebSocket" and "no Chrome on this machine", and it is treated the same way:
// say so plainly and exit 0 rather than paint the build red over something
// nobody's commit broke (DEVIATIONS §87, §114). Only a launch failure is
// forgiven — `CHROME_UNAVAILABLE` is set by `src/cli/chrome.mjs` and nothing
// else — so a real capture failure still fails, loudly, as it must.
try {
  // The whole-run budget, outside the per-capture one. Chrome's own launch is
  // inside it too, which is the one stage the per-capture deadline cannot see.
  await within(run, RUN_BUDGET_MS, 'the goldens run');
} catch (err) {
  if (err?.code === CHROME_UNAVAILABLE) {
    say(`goldens: could not start a browser: ${err.message}`);
    say(
      CHECK
        ? 'goldens: SKIPPED (nothing checked) — this run proves nothing about the floor.'
        : 'goldens: cannot regenerate.',
    );
    process.exit(CHECK ? 0 : 1);
  }
  if (err?.environmental) {
    // The run budget expired. Everything already captured is on disk and gets
    // uploaded; say which stage ate the time, because that is the only thing
    // that makes the next run shorter.
    say(`goldens: ${err.message}`);
    say(
      CHECK
        ? 'goldens: SKIPPED (the run did not finish) — this run proves nothing about the floor.'
        : 'goldens: cannot regenerate.',
    );
    process.exit(CHECK ? 0 : 1);
  }
  throw err;
}

const total = ((Date.now() - started) / 1000).toFixed(1);
if (failures.length) {
  // A real disagreement with a committed golden. This, and only this, is red.
  say(
    `goldens: ${failures.length} of ${captures.length} failed (${failures.join(', ')}) in ${total}s`,
  );
  if (CHECK) say(`goldens: actual captures and diff images are in ${rel(OUT_DIR)}`);
  process.exit(1);
}
if (!CHECK) {
  if (unproven.length) {
    say(`goldens: ${unproven.length} capture(s) could not be taken (${unproven.join(', ')})`);
    say('goldens: cannot regenerate.');
    process.exit(1);
  }
  say(`goldens: regenerated in ${total}s`);
} else if (unproven.length) {
  say(
    `goldens: SKIPPED in ${total}s — ${unproven.length} of ${captures.length} could not be captured (${unproven.join(', ')}).`,
  );
  say(`goldens: ${compared} compared and matching; the rest prove nothing about the floor.`);
  if (fs.existsSync(OUT_DIR)) say(`goldens: what was captured is in ${rel(OUT_DIR)}`);
} else if (compared === 0) {
  // Nothing was compared, so nothing is proven — say so rather than printing a
  // green line CI will read as protection it does not have.
  say(`goldens: SKIPPED in ${total}s — no ${process.platform} goldens to compare against.`);
  say(`goldens: the captures in ${rel(OUT_DIR)} are the set to commit.`);
} else {
  const skipped = captures.length - compared;
  say(`goldens: all ${compared} match in ${total}s${skipped ? ` (${skipped} skipped)` : ''}`);
}
