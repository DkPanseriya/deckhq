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
 *   node scripts/goldens.mjs [--check] [--strict] [--only NAME] [--theme NAME]
 *                            [--settle MS] [--stage WxH] [--keep] [--verbose]
 *                            [--deadline S] [--budget S]
 *
 * `--strict` says this platform's set is meant to be COMPLETE, so a capture
 * with no golden yet exits non-zero instead of being reported as not yet baked.
 * See `scripts/lib/goldens-gate.mjs` for the three outcomes and DEVIATIONS §180.
 *
 * `--stage 1920x1080` photographs the floor on a window other than the one the
 * committed goldens were taken in (WP-59). The capture lands in
 * test/goldens/.out/ and nothing compares it; it exists to be looked at.
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
 *     titles, ages and token counts; no random source);
 *   - and no CLOCK either, since WP-63: every capture runs with `DECKHQ_NOW`
 *     pinned to `DEMO_EPOCH`, so the fixture is seeded against that instant,
 *     the daemon serves it as the snapshot's `now`, and every age the client
 *     draws — "2d 7h", "oldest 4d 10h", the waiting badges, the idle list —
 *     is a fixed string rather than a photograph of the day the capture ran;
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
 *   an artifact to be committed. A platform with a PARTIAL set is the same
 *   thing per capture rather than per platform: the ones with a golden are
 *   compared, the ones without are reported NOT YET BAKED, and only a real
 *   disagreement is red (§180).
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
import { DEMO_EPOCH } from './demo-args.mjs';
import { decide } from './lib/goldens-gate.mjs';
import { decodePng, diffImages, encodePng } from './lib/png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};

const CHECK = has('--check');
/**
 * This platform's set is meant to be complete: a capture with no golden yet
 * exits non-zero instead of reading NOT YET BAKED. Off by default, because the
 * linux set is 6 of 16 and a gate that is red for a non-pixel reason is a gate
 * nobody reads (§180, audit A-01). The bake package turns it on.
 */
const STRICT = has('--strict');
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

/**
 * Every population `scripts/demo-floor.mjs --population` accepts.
 *
 * `three` is WP-59b's: three active repos is the smallest room count a row
 * cannot be split evenly into, and it is the shape that showed the packer
 * dealing two-and-one and drawing the lone room beside two thirds of a bare
 * band.
 *
 * `pinned` is WP-77's, and it is `three` with one repo pinned: the same nine
 * sessions, so the two captures differ in exactly one thing and the strip along
 * the bottom of the working side is the whole of what moved.
 */
const POPULATIONS = ['demo', 'empty', 'single', 'three', 'pinned', 'reference'];

/**
 * THE PHASE `crew` IS PINNED AT — WP-89, `12-MOTION-AND-CREW.md` §5's own 0.16.
 *
 * A sixth of the way through the pulse loop, which is where a pulse has left its
 * laptop and is plainly on the cable rather than sitting on either end of it. It
 * is a different number from `MOTION_PHASE` deliberately: 0.25 with four pulses
 * on a cable puts one of them exactly at the port, and a pulse standing on the
 * desk is the one frame that does not read as travel.
 */
export const CREW_PHASE = 0.16;

/**
 * THE PHASE `demo@motion` IS PINNED AT — `12-MOTION-AND-CREW.md` §5, verbatim:
 * *"a golden fixture captures `demo@phase` at phase 0.25 — where the typing
 * cadence is at its second stroke, the wave at its widest, the page edge-on and
 * the power-down at frame 2"*.
 *
 * It is a quarter of the way through EVERY animation's own cycle, which is what
 * makes one number enough for a strip of eleven of them with periods from
 * 0.24 s to 20 s.
 */
export const MOTION_PHASE = 0.25;

/**
 * The captures this gate takes: the five default-theme populations, plus one
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
 * A capture may name its own STAGE (WP-59d). `wide` is the `three` population
 * on a 1920 x 1080 window rather than the 1600 x 1000 one every other capture
 * uses, and it is a committed golden because the floor has two ARRANGEMENTS
 * now and the second one is only ever chosen on a wide stage: without it the
 * whole of `plan-rows.js` is outside the gate, and the picture the owner
 * actually looks at is the one nothing photographs. It is the same fixture as
 * `three`, so the pair is also the clearest statement of what the arrangement
 * choice does — one floor, two windows, two buildings.
 *
 * A capture may also name KEYS to press once the floor has settled (WP-93).
 * `three@selected` is the `three` floor with `j` pressed: `j` walks the
 * needs-you queue, so it selects the session that has waited longest and opens
 * its panel — and since WP-93 that is the one thing on this floor a user can do
 * that MOVES somebody. The waiting sit on the reception sofas; the one you open
 * gets up and walks to the chair at the manager's desk. Without this capture
 * the whole of that behaviour is outside the gate, because every other golden
 * photographs a floor nobody has touched.
 *
 * A capture may also turn MOTION ON (WP-87). Every capture before this one was
 * taken under emulated `prefers-reduced-motion: reduce`, which is why
 * `docs/DEVIATIONS.md` §162.9 could report *0 px moved at all*: the committed
 * set was — all of it — the reduced-motion render, and no animation the product
 * has ever had appeared in any of it. `demo@motion` is the fix. It photographs
 * the `demo` floor with motion ON and `?phase=` pinning every animation to the
 * same point of its own cycle, so the capture is still byte-identical across
 * two runs while the typing stroke, the wave, the page flip and the power-down
 * are all visible in it. The phase is `MOTION_PHASE` below, and it is
 * `12-MOTION-AND-CREW.md` §5's own.
 *
 * A capture may also open a SURFACE through the command palette and scroll to a
 * section of it (WP-88b). `look` is the settings sheet standing on the Look
 * section, with the six preset thumbnails painted, and it is the one golden this
 * product has of a form rather than of a floor — because §4's whole claim is
 * that a swatch is painted by the real floor painter, and the only thing that
 * can check a painter is a picture. It is reached the way a person reaches it:
 * the palette's own key, the command's accelerator, Enter. No test seam is added
 * to the client for it, so what this photographs is the path a user has.
 *
 * A capture may also CLICK one control after its command (WP-96), named by a
 * selector, for a state that has no key of its own. `board` is the Studio board
 * with the panel shut by its own ✕: the board is opened on the project of the
 * session in the panel, and closing the panel afterwards is how a person gets
 * the board the whole window wide. A selector that matches nothing fails the
 * capture, `scrollTo`'s rule.
 *
 * @type {ReadonlyArray<{name:string, population:string, theme:string,
 *   stage?:{w:number, h:number}, press?:string, motion?:boolean, query?:string,
 *   command?:string, click?:string, scrollTo?:string}>}
 */
const CAPTURES = [
  ...POPULATIONS.map((population) => ({ name: population, population, theme: 'default' })),
  { name: 'wide', population: 'three', theme: 'default', stage: { w: 1920, h: 1080 } },
  { name: 'three@selected', population: 'three', theme: 'default', press: 'j' },
  {
    name: 'demo@motion',
    population: 'demo',
    theme: 'default',
    motion: true,
    query: `phase=${MOTION_PHASE}`,
  },
  // WP-88b. `,` is the Settings command's accelerator, so the palette's key,
  // then one character, then Enter — the two-keystroke promise §5.3 is accepted
  // against, used here as the way in.
  {
    name: 'look',
    population: 'three',
    theme: 'default',
    command: ',',
    scrollTo: 'settings-look',
  },
  // WP-88c · THE TWO SIZES, through `?scale=` (`public/url-options.js`).
  //
  // §5's own reasoning, and it is `demo@motion`'s: *"the furniture grew with the
  // figure" is exactly the class of bug (§26, §52, §55) that passes every unit
  // test and is obvious in one screenshot.* A desk that did not grow with the
  // robot at it is a robot sitting through a desk, and no assertion over an
  // emitted plan can see that a picture looks wrong.
  //
  // TWO, and at opposite ends, because the two ends fail differently. `large` is
  // where furniture that did not follow the body shows — a 3.15 U figure at a
  // 2.6 U desk — and it is taken on `three`, a floor with room to be generous.
  // `small` is where LEGIBILITY goes: twenty-seven people at 0.8, every body over
  // the 16 px floor and every name still clear of a head, which is the `demo`
  // floor's own question. The other twelve are `medium` and must not move at all.
  { name: 'three@large', population: 'three', theme: 'default', query: 'scale=large' },
  { name: 'demo@small', population: 'demo', theme: 'default', query: 'scale=small' },
  // WP-89 · THE CREW, TWICE, AND THE PAIR IS THE POINT.
  //
  // `crew` is the formation with motion ON and `?phase=` pinned at `CREW_PHASE`:
  // five juniors seated in an arc, five cables, pulses mid-run on the two whose
  // transcripts are still moving, one laptop caught half folded, and two grey
  // cables on the pair that have finished. Everything in §3.2 that is a picture
  // rather than a sentence is in this one frame.
  //
  // `crew@reduced` is the same floor under emulated `prefers-reduced-motion`,
  // and it is a SEPARATE capture rather than a variant because §1.2's claim is
  // that the reduced form still informs: no pulses, the count badge on the desk,
  // and the green/grey difference kept. Two pictures are the only way to check
  // that the second one is still worth looking at.
  {
    name: 'crew',
    population: 'crew',
    theme: 'default',
    motion: true,
    query: `phase=${CREW_PHASE}`,
  },
  { name: 'crew@reduced', population: 'crew', theme: 'default' },
  // WP-69 · THE STUDIO BOARD, and it is the product's only golden of a surface
  // with rows in it rather than a floor or a form.
  //
  // §5.4's acceptance is partly a claim about a picture — six columns in board
  // order, a card carrying its assignee's own robot, a column with nothing in
  // it still drawing its head and its count, and the real `<table>` underneath
  // scrolled past the columns. Every one of those is asserted over a DOM in
  // `board-view.test.mjs`, and not one of them says whether the result is
  // LEGIBLE: eight cards at this stage size, four chips on the widest of them,
  // and a canvas face at 28 px beside a title that must not wrap into it.
  //
  // The way in is the way a person has, `look`'s rule. `j` selects the session
  // at the head of the needs-you queue, which on the `board` population is the
  // one repo the fixture enabled Studio on — the board draws the project in
  // view, and without a selection there is no project to draw. Then the
  // palette, `studio board` typed into it, and Enter. `Studio: board` carries
  // no accelerator (no Studio row does), so this capture types rather than
  // chords, which is also the path the command's own keywords are ranked on.
  //
  // WP-96 · TWO OF IT. `board` is the board with the panel then shut by its own
  // ✕, so the board has the whole window: all six columns in one row. The
  // panel-open board it used to be showed two of the six and hid four behind a
  // sideways scroll, and it is kept as `board@panel` because that is the case
  // the fix is FOR — the board yielding width to the panel and still showing
  // every column (at 1600 x 1000 it is still one row; see `arrangeColumns()`).
  {
    name: 'board',
    population: 'board',
    theme: 'default',
    press: 'j',
    command: 'studio board',
    click: '#panel button[aria-label="Close panel"]',
  },
  {
    name: 'board@panel',
    population: 'board',
    theme: 'default',
    press: 'j',
    command: 'studio board',
  },
  ...THEME_NAMES.filter((theme) => theme !== 'default').map((theme) => ({
    name: `demo@${theme.replace(/\s+/g, '-')}`,
    population: 'demo',
    theme,
  })),
];

/**
 * The stage every committed golden is photographed on. One size, so a golden
 * is a comparison rather than a coincidence.
 */
export const DEFAULT_WIDTH = 1600;
export const DEFAULT_HEIGHT = 1000;

/**
 * `--stage 1920x1080` — photograph the floor on a different window (WP-59).
 *
 * WP-59's defect only shows on a stage the building has room to be small in:
 * at 1600 x 1000 the reference floor was already covering 62% of the width, and
 * at 1920 x 1080 it was 52%. A gate that can only see one window size cannot be
 * asked whether the fix held on the others, so the size is a flag.
 *
 * A capture at a non-default stage is written to `test/goldens/.out/` and named
 * with the stage — `reference@1920x1080.actual.png` — rather than into the
 * committed set, and nothing compares it. It is a photograph to LOOK at.
 * Committing one would be a second golden of the same floor that no CI job
 * takes and that would rot the moment anything moved; the tolerance and the
 * noise floor in §87 were measured at one size, and a second set would have to
 * earn its own.
 */
const stageArg = opt('--stage', '');
const stageMatch = /^(\d{3,5})\s*[x×]\s*(\d{3,5})$/i.exec(String(stageArg).trim());
if (stageArg && !stageMatch) {
  process.stderr.write(`goldens: --stage wants WxH, e.g. --stage 1920x1080 (got "${stageArg}")\n`);
  process.exit(2);
}
export const WIDTH = stageMatch ? Number(stageMatch[1]) : DEFAULT_WIDTH;
export const HEIGHT = stageMatch ? Number(stageMatch[2]) : DEFAULT_HEIGHT;
/** True when this run is photographing a window the goldens were not taken in. */
const OFF_STAGE = WIDTH !== DEFAULT_WIDTH || HEIGHT !== DEFAULT_HEIGHT;
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
if (CHECK && OFF_STAGE) {
  // A golden taken at 1600 x 1000 and a capture taken at 1920 x 1080 are two
  // pictures of two things. Comparing them reports a size mismatch, which says
  // nothing about the floor and everything about the flags.
  process.stderr.write('goldens: --check compares against the committed stage; drop --stage\n');
  process.exit(2);
}

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
      {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        // WP-63. The clock, pinned for the whole child: the fixture seeds
        // every timestamp against it and the daemon serves it to the browser,
        // so a golden stops being a photograph of the day it was taken. It is
        // set here rather than left to the environment so that a developer who
        // happens to export `DECKHQ_NOW` cannot move the goldens.
        env: { ...process.env, DECKHQ_NOW: DEMO_EPOCH },
      },
    );
    let out = '';
    let settled = false;
    /**
     * Stop the demo, and do not wait forever for it to agree.
     *
     * The demo daemon shuts down gracefully on SIGTERM, and `close()` waits
     * for `server.close()`, which waits for every open connection to end. A
     * browser still parked on this demo's page used to hold that open forever,
     * because an SSE stream is a request in flight that never finishes;
     * `close()` now ends its own streams and returns in milliseconds
     * regardless (docs/DEVIATIONS.md §128). The caller still navigates away
     * first — releasing the page is the honest thing to do and it is one
     * command — and this stays as the backstop for every OTHER way a child can
     * refuse to leave: SIGTERM, then SIGKILL, then give up and carry on. An
     * unreaped demo on a CI runner that is about to be destroyed is not worth
     * a hung gate. docs/DEVIATIONS.md §126.3.
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
 * Press one key on the settled floor, the way a person would (WP-93).
 *
 * `rawKeyDown` + `char` + `keyUp` rather than a synthetic DOM event: the app
 * listens on the document for real `keydown`, and dispatching through the
 * protocol is the only way to reach it that also proves the listener is wired.
 * The floor is then given the settle window again — a selection re-seats the
 * reception and somebody walks — and `captureStill` still refuses to photograph
 * anything that has not stopped.
 * @param {ReturnType<typeof import('../src/cli/chrome.mjs').connect>} client
 * @param {string} keys one character each, in order
 */
async function pressKeys(client, keys) {
  for (const key of String(keys)) {
    for (const type of ['rawKeyDown', 'char', 'keyUp']) {
      await client.send('Input.dispatchKeyEvent', { type, text: key, key, unmodifiedText: key });
    }
    await sleep(120);
  }
}

/**
 * One key with modifiers held, and no `char` (WP-88b).
 *
 * `pressKeys` above sends `char` because it is typing; a chord is not typing,
 * and a `char` event under Ctrl is what a browser would never send. `modifiers`
 * is CDP's bitfield — 2 is Ctrl, which is the palette's key on the platform
 * every golden is taken on.
 *
 * @param {ReturnType<typeof import('../src/cli/chrome.mjs').connect>} client
 * @param {string} key
 * @param {number} modifiers
 */
async function pressChord(client, key, modifiers) {
  for (const type of ['rawKeyDown', 'keyUp']) {
    await client.send('Input.dispatchKeyEvent', { type, key, modifiers, windowsVirtualKeyCode: 0 });
  }
  await sleep(200);
}

/**
 * Enter, as the platform sends it: a key event with a carriage return as its
 * text, which is what a `<dialog>`'s own handlers and the palette's row runner
 * both listen for.
 * @param {ReturnType<typeof import('../src/cli/chrome.mjs').connect>} client
 */
async function pressEnter(client) {
  for (const type of ['rawKeyDown', 'char', 'keyUp']) {
    await client.send('Input.dispatchKeyEvent', {
      type,
      key: 'Enter',
      code: 'Enter',
      text: '\r',
      unmodifiedText: '\r',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    });
  }
  await sleep(200);
}

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
    new Error(
      'the floor kept changing between screenshots; is reduced motion being honoured, ' +
        'or (on a motion capture) is `?phase=` reaching the renderer?',
    ),
    { environmental: true },
  );
}

/**
 * Compare one capture against its golden; write the actual and a diff image
 * to OUT_DIR when they disagree.
 *
 * Three outcomes, and `scripts/lib/goldens-gate.mjs` holds what they mean:
 * `match`, `missing` (no golden for this capture on this platform yet — NOT
 * YET BAKED, never a failure, §180) and `fail` (a golden exists and the
 * picture disagrees with it, which is the only red this gate has).
 * @param {string} name
 * @param {Buffer} actualPng
 * @returns {{outcome:import('./lib/goldens-gate.mjs').Outcome, detail:string}}
 */
function check(name, actualPng) {
  const goldenFile = path.join(GOLDENS_DIR, `${name}.png`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const actualFile = path.join(OUT_DIR, `${name}.actual.png`);

  if (!fs.existsSync(goldenFile)) {
    // A hole in a partial set is the same thing as an empty set, one capture
    // at a time: nothing has been proved about the floor, so nothing is red.
    // The picture goes to OUT_DIR, which is the artifact CI uploads, which is
    // how the golden gets baked and committed.
    fs.writeFileSync(actualFile, actualPng);
    return {
      outcome: 'missing',
      detail: `not yet baked on ${process.platform} — run \`npm run goldens\` and commit ${rel(goldenFile)}; capture left at ${rel(actualFile)}`,
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
      outcome: 'fail',
      detail: `size ${actual.width}x${actual.height}, golden is ${expected.width}x${expected.height}`,
    };
  }
  if (fraction > MAX_DIFF_FRACTION) {
    const diffFile = path.join(OUT_DIR, `${name}.diff.png`);
    fs.writeFileSync(actualFile, actualPng);
    fs.writeFileSync(diffFile, encodePng(result.diff));
    return {
      outcome: 'fail',
      detail: `${result.differing.toLocaleString('en-US')} of ${result.total.toLocaleString('en-US')} px over tolerance (${pct}, budget ${(MAX_DIFF_FRACTION * 100).toFixed(2)}%), ${noise} — see ${rel(diffFile)}`,
    };
  }
  return {
    outcome: 'match',
    detail: `${result.differing.toLocaleString('en-US')} px over tolerance (${pct} of budget ${(MAX_DIFF_FRACTION * 100).toFixed(2)}%), ${noise}`,
  };
}

// --------------------------------------------------------------------- run

const started = Date.now();
say(
  `goldens: ${CHECK ? 'checking' : 'regenerating'} ${captures.length} capture(s) on ` +
    `${process.platform}, ${OFF_STAGE ? `${WIDTH}x${HEIGHT} (every capture)` : `${DEFAULT_WIDTH}x${DEFAULT_HEIGHT} unless the capture says otherwise`}` +
    `, reduced motion unless the capture says otherwise, settle ${SETTLE_MS} ms`,
);

/**
 * One entry per capture that produced a picture, for `decide()` at the end:
 * `match`, `missing` or `fail`. Captures that could not be TAKEN are not in
 * here — they are `unproven` below.
 * @type {import('./lib/goldens-gate.mjs').CaptureVerdict[]}
 */
const verdicts = [];
/**
 * Captures that could not be taken at all — a demo that would not boot, a
 * floor that would not settle, a browser that stopped answering, a deadline.
 * None of them says anything about the pixels, so none of them is a failure;
 * they are reported and the run exits SKIPPED. §87, §114 and §126.3.
 */
const unproven = [];
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
    /**
     * Reduced motion is emulated PER CAPTURE since WP-87, because one capture
     * now wants it off. It is still set before every single one rather than
     * only when it changes: the emulation is the difference between a
     * photograph of a state and a photograph of a moment, and a capture that
     * inherited the previous one's setting would be a golden nobody could
     * reproduce from the list alone.
     * @param {boolean} reduce
     */
    const emulateMotion = async (reduce) => {
      enter(reduce ? 'emulating reduced motion' : 'allowing motion');
      await client.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }],
      });
    };
    await emulateMotion(true);

    for (const capture of captures) {
      const { name, population, theme } = capture;
      const t0 = Date.now();
      // THE STAGE THIS CAPTURE IS TAKEN ON. `--stage` overrides every capture,
      // because a run that asks for one window means it; otherwise a capture
      // may name its own and the rest take the committed default. The viewport
      // is emulated rather than the window resized, which is what `withChrome`
      // does for the default size too — one mechanism, so a 1920 x 1080
      // capture and a 1600 x 1000 one differ in nothing but their numbers.
      const shotW = OFF_STAGE ? WIDTH : (capture.stage?.w ?? DEFAULT_WIDTH);
      const shotH = OFF_STAGE ? HEIGHT : (capture.stage?.h ?? DEFAULT_HEIGHT);

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

            enter(`sizing the stage to ${shotW}x${shotH} ("${name}")`);
            await client.send('Emulation.setDeviceMetricsOverride', {
              width: shotW,
              height: shotH,
              deviceScaleFactor: 1,
              mobile: false,
            });

            await emulateMotion(capture.motion !== true);

            // WP-87: a capture may carry its own query string. `?phase=` pins
            // every animation's phase without disabling motion — see
            // `public/url-options.js` — which is the whole seam `demo@motion`
            // is taken through.
            const url = capture.query
              ? `${demo.url}${demo.url.includes('?') ? '&' : '?'}${capture.query}`
              : demo.url;
            enter(`navigating to ${url}`);
            await client.send('Page.navigate', { url });

            enter(`waiting for the floor to settle ("${name}")`);
            const state = await waitForFloor(client);

            if (capture.press) {
              enter(`pressing "${capture.press}" ("${name}")`);
              await pressKeys(client, capture.press);
              await sleep(SETTLE_MS);
            }

            // WP-88b. The palette, a command's accelerator, Enter — the way a
            // person opens the surface this capture photographs.
            if (capture.command) {
              enter(`running "${capture.command}" from the palette ("${name}")`);
              await pressChord(client, 'k', 2);
              await pressKeys(client, capture.command);
              await pressEnter(client);
              await sleep(SETTLE_MS);
            }
            if (capture.click) {
              enter(`clicking ${capture.click} ("${name}")`);
              const { result } = await client.send('Runtime.evaluate', {
                returnByValue: true,
                expression: `(() => {
                  const el = document.querySelector(${JSON.stringify(capture.click)});
                  if (!el) return false;
                  el.click();
                  return true;
                })()`,
              });
              if (!result.value) throw new Error(`${capture.click} is not on the page`);
              await sleep(SETTLE_MS);
            }
            if (capture.scrollTo) {
              enter(`scrolling to #${capture.scrollTo} ("${name}")`);
              const { result } = await client.send('Runtime.evaluate', {
                returnByValue: true,
                expression: `(() => {
                  const el = document.getElementById(${JSON.stringify(capture.scrollTo)});
                  if (!el) return false;
                  el.scrollIntoView({ block: 'start' });
                  return true;
                })()`,
              });
              // A capture that could not find the thing it is a photograph of
              // must fail here rather than quietly become a golden of the floor.
              if (!result.value) throw new Error(`#${capture.scrollTo} is not on the page`);
              await sleep(SETTLE_MS);
            }

            enter(`screenshotting ("${name}")`);
            const png = await captureStill(client);
            const secs = ((Date.now() - t0) / 1000).toFixed(1);

            if (CHECK) {
              const verdict = check(name, png);
              verdicts.push({ name, outcome: verdict.outcome });
              const tag = { match: 'ok  ', missing: 'MISS', fail: 'FAIL' }[verdict.outcome];
              say(
                `  ${tag} ${name.padEnd(18)} ${state.agents} agents  ${secs}s  ${verdict.detail}`,
              );
            } else {
              // A capture at a stage the goldens were not taken in never joins
              // the committed set — see `--stage`. It goes to `.out/`, which is
              // gitignored, so `npm run goldens -- --stage 1920x1080` is safe to
              // run without leaving the set half one size and half another.
              const dir = OFF_STAGE ? OUT_DIR : GOLDENS_DIR;
              fs.mkdirSync(dir, { recursive: true });
              const file = path.join(
                dir,
                OFF_STAGE ? `${name}@${shotW}x${shotH}.actual.png` : `${name}.png`,
              );
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
if (!CHECK) {
  if (unproven.length) {
    say(`goldens: ${unproven.length} capture(s) could not be taken (${unproven.join(', ')})`);
    say('goldens: cannot regenerate.');
    process.exit(1);
  }
  say(`goldens: regenerated in ${total}s`);
} else {
  // THE VERDICT. `decide()` is the rule, and it is in its own module because it
  // is the half of this gate a test can reach without a browser (§180).
  const verdict = decide(verdicts, { strict: STRICT, platform: process.platform });

  if (verdict.failed.length) {
    // A real disagreement with a committed golden. This, and only this, is red.
    say(`goldens: ${verdict.headline} in ${total}s`);
    say(`goldens: actual captures and diff images are in ${rel(OUT_DIR)}`);
  } else if (unproven.length) {
    say(
      `goldens: SKIPPED in ${total}s — ${unproven.length} of ${captures.length} could not be captured (${unproven.join(', ')}).`,
    );
    say(`goldens: ${verdict.headline}; the rest prove nothing about the floor.`);
    if (fs.existsSync(OUT_DIR)) say(`goldens: what was captured is in ${rel(OUT_DIR)}`);
  } else {
    say(`goldens: ${verdict.headline} in ${total}s`);
  }
  if (verdict.missing.length && !verdict.failed.length) {
    // Named, not hidden: this is the list the bake package downloads and
    // commits, and the list `--strict` refuses once it is meant to be empty.
    say(`goldens: the captures in ${rel(OUT_DIR)} are the set to commit.`);
  }
  if (verdict.exitCode) process.exit(verdict.exitCode);
}
