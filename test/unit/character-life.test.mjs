/**
 * WP-87 — character life.
 *
 * `docs/plan/12-MOTION-AND-CREW.md` §2's table is the contract this suite
 * guards, and §5 is its acceptance list. Seven properties, in the order the
 * package states them:
 *
 *   1. **Determinism.** The same clock draws the same frame, byte for byte.
 *   2. **Reduced motion.** Two clocks draw the SAME frame — there is no phase
 *      term left in the arithmetic at all — and it is still informative.
 *   3. **Honesty.** Nothing animates from a state or an event the registry did
 *      not report: no typing flash with no tool event in the window, no cloud
 *      over a closed turn, no power-down on a live session.
 *   4. **The LOD drop list**, read off the rig's own table rather than a copy.
 *   5. **The budget**, as DRAW CALLS rather than as wall-clock milliseconds —
 *      a timing assertion in a unit suite is a flake waiting for a slow runner.
 *   6. **The lounge**, a pure function of identity, bay and cycle.
 *   7. **Run versus walk**, which is the one claim in the whole package.
 *
 * Everything here runs against the real modules under `node --test`: `life.js`
 * is pure, and `drawCharacter` draws through a stub context that records every
 * call it is handed (docs/DEVIATIONS.md §122).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ACTIVITY_BAY,
  BAY_ACTIVITIES,
  FLICKER_MIN_GAP_MS,
  LIFE,
  LIFE_DROPPED_AT_L0,
  LIFE_NEVER_DROPPED,
  characterLife,
  lifeDrawnAt,
  lifeFrame,
  lifePhase,
  loungeActivityFor,
  loungeHoldMs,
  oneShot,
  pageFlip,
  powerDown,
  sinceS,
  thoughtLobes,
  tripRuns,
  turnIsOpen,
  visorFlicker,
} from '../../public/render/life.js';
import { drawCharacter, REST_LIFE } from '../../public/render/rig.js';
import { CLIPS, clipDuration, sampleClip } from '../../public/render/clips.js';
import { STATE_COLORS } from '../../public/render/palette.js';
import { AgentRuntime, assignSeats, RUN_SPEED, WALK_SPEED } from '../../public/render/agents.js';
import { buildPlan } from '../../public/render/plan.js';
import { pickSessionPhase } from '../../public/url-options.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

// ------------------------------------------- I-08, as a walk rather than a list
//
// The guard below used to name SIX files of the fifty-eight under
// `public/render/`. `rig.js` has been a re-export shell since §131 — the bodies
// are in `rig-pose.js`, `rig-metrics.js`, `rig-bubble.js` and `rig-traits.js`,
// and none of those was checked; neither were `crew.js`, `scene-draw.js`,
// `agents-*.js` or the four `backdrop-*` modules. Nothing was breached, and
// nothing would have noticed if it had been. WP-92c, audit finding A-03,
// `docs/DEVIATIONS.md` §180.
//
// So the list is gone and the rule is a walk with ONE named exception.

/** The clock and random sources a draw path may not read. */
const FORBIDDEN = /\b(Date\.now|Math\.random|performance\.now)\(\)/g;

/**
 * THE ONE EXCEPTION, and it is a named function rather than a named file:
 * `frameMs()` in `scene-agent.js` is FRAME PACING — an interval on this tab's
 * own timeline — so it is allowed `performance.now()` and the `Date.now()`
 * fallback under it. Everything else in that same file, and every other file
 * under `public/render/`, is a phase, and a phase comes from `animMs()`.
 */
const FRAME_CLOCK = {
  file: 'scene-agent.js',
  span: /export function frameMs\(\)\s*\{[\s\S]*?\n\}/,
};

/**
 * Source with its comments removed — the history is explained at length in
 * them, and the CODE must not repeat it.
 * @param {string} text
 */
function codeOnly(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Every draw-path module: everything under `public/render/`, plus any
 * `life`/`scene`/`rig`/`crew` module that ever lands beside it in `public/`
 * rather than inside it.
 * @param {string} publicDir
 * @returns {string[]} absolute paths
 */
function drawPathFiles(publicDir) {
  const renderDir = path.join(publicDir, 'render');
  const inRender = fs.existsSync(renderDir)
    ? fs
        .readdirSync(renderDir)
        .filter((f) => f.endsWith('.js'))
        .map((f) => path.join(renderDir, f))
    : [];
  const beside = fs
    .readdirSync(publicDir)
    .filter((f) => /^(life|scene|rig|crew)([-.]|$)/.test(f) && f.endsWith('.js'))
    .map((f) => path.join(publicDir, f));
  return [...inRender, ...beside].sort();
}

/**
 * The gate itself, over a `public/` directory — the real one, or a temp copy
 * with something planted in it, which is how this is proved to fail.
 * @param {string} publicDir
 * @returns {string[]} one line per violation, empty when the rule holds
 */
function drawPathViolations(publicDir) {
  /** @type {string[]} */ const found = [];
  for (const file of drawPathFiles(publicDir)) {
    let code = codeOnly(fs.readFileSync(file, 'utf8'));
    if (path.basename(file) === FRAME_CLOCK.file) {
      // Cut the exception out by its own shape. A `scene-agent.js` that stopped
      // declaring `frameMs()` would fail here rather than inherit its licence.
      code = code.replace(FRAME_CLOCK.span, '/* the frame clock */');
    }
    for (const hit of code.match(FORBIDDEN) ?? []) {
      found.push(`${path.relative(ROOT, file).split(path.sep).join('/')} calls ${hit}`);
    }
  }
  return found;
}

/** A pinned instant, the way `DECKHQ_NOW` pins one. */
const NOW = 1_800_000_000_000;

/** @param {string} id @param {object} over */
function agent(id, over = {}) {
  return {
    id,
    projectId: 'p0',
    projectMk: 'MK1',
    activityState: 'working',
    ackState: 'active',
    reviewSince: null,
    needsInputSince: null,
    lastActivityAt: NOW - 60_000,
    ...over,
  };
}

/** A canvas context that draws nothing and remembers everything. */
function stubCtx() {
  const calls = [];
  const record =
    (name) =>
    (...args) => {
      calls.push({ name, args });
    };
  return {
    calls,
    canvas: { width: 0, height: 0 },
    globalAlpha: 1,
    save: record('save'),
    restore: record('restore'),
    beginPath: record('beginPath'),
    closePath: record('closePath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    arc: record('arc'),
    ellipse: record('ellipse'),
    quadraticCurveTo: record('quadraticCurveTo'),
    bezierCurveTo: record('bezierCurveTo'),
    fill: record('fill'),
    stroke: record('stroke'),
    fillRect: record('fillRect'),
    strokeRect: record('strokeRect'),
    clearRect: record('clearRect'),
    fillText: record('fillText'),
    strokeText: record('strokeText'),
    translate: record('translate'),
    rotate: record('rotate'),
    scale: record('scale'),
    setTransform: record('setTransform'),
    drawImage: record('drawImage'),
    setLineDash: record('setLineDash'),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    measureText: (text) => ({ width: String(text).length * 6 }),
  };
}

/**
 * Draw one figure the way `scene-draw.js` does — clip sampled at the phase,
 * life computed at the clock — and hand back the recorded calls.
 * @param {object} a the agent
 * @param {{now?:number, reduced?:boolean, pinned?:number|null, lod?:0|1|2,
 *   state?:string, clip?:string, flickerAt?:number|null, spawnAt?:number|null,
 *   leftAt?:number|null, walking?:boolean, running?:boolean}} [opts]
 */
function drawOne(a, opts = {}) {
  const ctx = stubCtx();
  const now = opts.now ?? NOW;
  const reduced = opts.reduced === true;
  const pinned = opts.pinned ?? null;
  const lod = opts.lod ?? 2;
  const state = opts.state ?? a.activityState;
  const clip = opts.clip ?? 'type';
  const t = pinned === null ? (now - (a.lastActivityAt ?? 0)) / 1000 : pinned * clipDuration(clip);
  const pose = sampleClip(clip, t, reduced);
  drawCharacter(ctx, pose, {
    x: 200,
    y: 200,
    u: 24,
    lod,
    color: STATE_COLORS[state] || STATE_COLORS.working,
    state,
    reduced,
    seconds: now / 1000,
    phase: pinned,
    life: characterLife(a, {
      nowMs: now,
      state,
      lod,
      reduced,
      pinned,
      flickerAt: opts.flickerAt ?? null,
      spawnAt: opts.spawnAt ?? null,
      leftAt: opts.leftAt ?? null,
      walking: opts.walking === true,
      running: opts.running === true,
    }),
  });
  return ctx.calls;
}

// ------------------------------------------------- 0. the clock, and the fix

test('WP-87 · the animation clock is the injected one, and `performance.now()` is only frame pacing', () => {
  // The finding this package opened on: `nowMs()` was `performance.now()` and
  // was subtracted from an epoch `clipStartedAt`, so no fixture could pin a
  // phase and every committed golden was the reduced-motion render. The proof
  // that it is fixed is structural and belongs in the source: `scene-agent.js`
  // must read `../clock.js`, and `performance.now()` must appear in exactly one
  // function, the one named for frame pacing.
  const src = fs.readFileSync(path.join(ROOT, 'public/render/scene-agent.js'), 'utf8');
  assert.match(src, /from '\.\.\/clock\.js'/, 'the animation clock is not clock.js');
  // Comments explain the history at length; the CODE must call it once, inside
  // the function named for frame pacing and nowhere else.
  const bare = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.equal(
    (bare.match(/performance\.now\(\)/g) || []).length,
    1,
    'performance.now() appears somewhere other than the frame clock',
  );
  assert.match(bare, /export function frameMs\(\)[\s\S]*?performance\.now\(\)/);
  assert.match(bare, /export function animMs\(\)[\s\S]*?return clockNow\(\);/);
});

test('I-08 · no draw-path module reads the machine clock or a random source', () => {
  // Every module under `public/render/`, not six of them. The only hit this is
  // allowed to forgive is `frameMs()`'s own body, and it is cut out by shape.
  const publicDir = path.join(ROOT, 'public');
  const files = drawPathFiles(publicDir);
  assert.ok(files.length >= 55, `expected the whole render tree, walked ${files.length} files`);
  for (const name of ['rig-pose.js', 'crew.js', 'scene-draw.js', 'backdrop-paint.js']) {
    assert.ok(
      files.some((f) => path.basename(f) === name),
      `${name} is not in the walk — the list is back`,
    );
  }
  assert.deepEqual(drawPathViolations(publicDir), []);
});

test('I-08 · the guard is a walk, so a planted clock anywhere under render/ fails it', () => {
  // Proved against a temp copy rather than the tree: a gate nobody has seen
  // fail is a gate nobody knows the shape of, and this is the exact shape §131
  // moved out from under the old six-file list.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deckhq-drawpath-'));
  try {
    const renderDir = path.join(dir, 'render');
    fs.mkdirSync(renderDir, { recursive: true });
    fs.writeFileSync(
      path.join(renderDir, 'rig-pose.js'),
      'export function poseFor(a) {\n  return a.t - Date.now();\n}\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(renderDir, 'clean.js'),
      '// Date.now() in a comment is history, not code.\nexport const K = 1;\n',
      'utf8',
    );
    const found = drawPathViolations(dir);
    assert.deepEqual(found.length, 1, `expected one violation, got ${JSON.stringify(found)}`);
    assert.match(found[0], /rig-pose\.js calls Date\.now\(\)/);

    // And a module named for the draw path that lands BESIDE render/ rather
    // than inside it is walked too.
    fs.writeFileSync(path.join(dir, 'scene-extra.js'), 'export const r = Math.random();\n', 'utf8');
    assert.equal(drawPathViolations(dir).length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('WP-87 · `?phase=` pins a frame without disabling motion, and refuses anything else', () => {
  assert.equal(pickSessionPhase('?phase=0.25'), 0.25);
  assert.equal(pickSessionPhase('?phase=0'), 0);
  assert.equal(pickSessionPhase(''), null, 'absent means "use the clock"');
  assert.equal(pickSessionPhase('?phase=1'), null, '1 is not in [0, 1)');
  assert.equal(pickSessionPhase('?phase=-0.2'), null);
  assert.equal(
    pickSessionPhase('?phase=soon'),
    null,
    'a URL a stranger wrote may at worst do nothing',
  );
  // Pinned is NOT reduced: the phase is the pin's, and the frame still moves.
  assert.equal(lifePhase(999, 0.9, { pinned: 0.25 }), 0.25);
  assert.equal(lifePhase(999, 0.9, { reduced: true, pinned: 0.25 }), 0, 'reduced beats pinned');
});

// ------------------------------------------------------------ 1. determinism

test('DETERMINISM · the same clock draws the same frame, byte for byte', () => {
  const a = agent('a', { activityState: 'working', lastActivityAt: NOW - 30_000 });
  const first = drawOne(a, { now: NOW });
  const second = drawOne(a, { now: NOW });
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test('DETERMINISM · a pinned phase draws the same frame at two different clocks', () => {
  // This is the whole of the `demo@motion` golden: motion is ON, so the figure
  // is mid-animation, and the capture is still reproducible.
  const a = agent('a', { activityState: 'working', lastActivityAt: NOW - 30_000 });
  const first = drawOne(a, { now: NOW, pinned: 0.25 });
  const later = drawOne(a, { now: NOW + 7_137, pinned: 0.25 });
  assert.equal(JSON.stringify(first), JSON.stringify(later));
});

test('DETERMINISM · an unpinned frame DOES move, or none of this is animation', () => {
  const a = agent('a', { activityState: 'stalled', lastActivityAt: NOW - 30_000 });
  const first = drawOne(a, { now: NOW, state: 'stalled', clip: 'slump' });
  const later = drawOne(a, { now: NOW + 1_000, state: 'stalled', clip: 'slump' });
  assert.notEqual(JSON.stringify(first), JSON.stringify(later), 'the floor is frozen');
});

// -------------------------------------------------------- 2. reduced motion

test('REDUCED MOTION · two renders at two different clocks are byte-identical', () => {
  for (const [state, clip] of [
    ['working', 'type'],
    ['needs_input', 'hand_raise'],
    ['for_review', 'stand_wait'],
    ['stalled', 'slump'],
    ['ended', 'slump'],
    ['benched', 'lounge_idle'],
  ]) {
    const a = agent(`a-${state}`, {
      activityState: state === 'benched' ? 'working' : state,
      ackState: state === 'benched' ? 'benched' : 'active',
      lastActivityAt: NOW - 30_000,
      reviewSince: state === 'for_review' ? NOW - 90_000 : null,
    });
    const still = drawOne(a, { now: NOW, reduced: true, state, clip });
    const later = drawOne(a, { now: NOW + 123_456, reduced: true, state, clip });
    assert.equal(
      JSON.stringify(still),
      JSON.stringify(later),
      `${state} moved between two clock readings under reduced motion`,
    );
  }
});

test('REDUCED MOTION · every term is still INFORMATIVE, not absent', () => {
  // §1.2: "the reduced form is the pose that best communicates the state".
  // Nothing here reduces to nothing.
  const reduced = { reduced: true };
  assert.equal(pageFlip(3, reduced), 1, 'the page is held flat, not gone');
  assert.equal(powerDown(NOW, NOW, reduced), 1, 'the power-down is frame 5 immediately');
  assert.equal(oneShot(NOW, NOW, 'spawn', reduced), 1, 'a new figure is simply present');
  assert.equal(oneShot(NOW, NOW, 'despawn', reduced), 1, 'a departed figure is simply gone');
  const stalled = characterLife(agent('s', { activityState: 'stalled' }), {
    nowMs: NOW,
    state: 'stalled',
    lod: 2,
    reduced: true,
  });
  assert.ok(stalled.dots > 0, 'a stalled figure keeps its two dots under reduced motion');
  const thinking = characterLife(
    agent('t', { activityState: 'working', lastActivityAt: NOW - 60_000 }),
    { nowMs: NOW, state: 'working', lod: 2, reduced: true },
  );
  assert.equal(thinking.lobes, 3, 'the cloud is kept at its size');
  assert.equal(thinking.cloud, 0, '...with no sway');
});

// ----------------------------------------------------------------- 3. honesty

test('HONESTY · no visor flicker without a tool event the registry reported', () => {
  const quiet = agent('a', { currentTool: null });
  const life = characterLife(quiet, { nowMs: NOW, state: 'working', lod: 2, flickerAt: null });
  assert.equal(life.flicker, 0, 'a session with no tool event flashed its visor');
  // A runtime that reports tool events, but has none open right now, is the
  // same answer — the flash is keyed to an instant, not to a field existing.
  assert.equal(visorFlicker(NOW, null), 0);
  assert.equal(visorFlicker(NOW, undefined), 0);
  assert.equal(visorFlicker(NOW, NOW - 10_000), 0, 'a tool call ten seconds ago is not a flash');
  assert.ok(visorFlicker(NOW, NOW) > 0, 'a tool call opening right now IS one');
});

test('HONESTY · the flicker is capped at one per 0.5 s, so a tool loop cannot strobe', () => {
  const plan = buildPlan([{ id: 'p0', name: 'deckhq', sessionCount: 1 }], [agent('a')], {
    targetAspect: 1.6,
    now: NOW,
  });
  const runtime = new AgentRuntime();
  const tick = (since, at) => {
    const a = agent('a', { currentTool: { name: 'Bash', summary: 'npm test', since } });
    runtime.sync([a], plan, assignSeats(plan, [a]), { now: at });
    return runtime.get('a').flickerAt;
  };
  assert.equal(tick(NOW, NOW), NOW, 'the first tool call fires');
  // Two more calls inside the window: the `since` moved, the flash did not.
  assert.equal(tick(NOW + 100, NOW + 100), NOW, 'a call 100 ms later restarted the flash');
  assert.equal(tick(NOW + 400, NOW + 400), NOW, 'a call 400 ms later restarted the flash');
  assert.equal(
    tick(NOW + FLICKER_MIN_GAP_MS, NOW + FLICKER_MIN_GAP_MS),
    NOW + FLICKER_MIN_GAP_MS,
    'a call past the cap did not fire',
  );
});

test('HONESTY · the thought cloud needs an open turn, no tool, and real quiet', () => {
  // §2: "a turn is open, no tool is running, and nothing has been written for
  // N seconds". All three, and nothing infers one from another.
  assert.equal(turnIsOpen(agent('a')), true);
  assert.equal(turnIsOpen(agent('a', { turnEnded: true })), false, 'a closed turn is not thinking');
  assert.equal(
    turnIsOpen(agent('a', { currentTool: { name: 'Bash', summary: 'x', since: NOW } })),
    false,
    'a running tool is not thinking',
  );
  assert.equal(turnIsOpen(agent('a', { activityState: 'for_review' })), false);
  assert.equal(turnIsOpen(agent('a', { ackState: 'benched' })), false);

  // And the growth is the document's: one lobe at 2 s, two at 6 s, three at
  // 15 s, then it STOPS.
  assert.equal(thoughtLobes(0), 0);
  assert.equal(thoughtLobes(1.9), 0);
  assert.equal(thoughtLobes(2), 1);
  assert.equal(thoughtLobes(5.9), 1);
  assert.equal(thoughtLobes(6), 2);
  assert.equal(thoughtLobes(14.9), 2);
  assert.equal(thoughtLobes(15), 3);
  assert.equal(thoughtLobes(60 * 60 * 24), 3, 'the cloud kept growing');

  // A working agent whose tool is open draws no cloud at all.
  const busy = characterLife(
    agent('a', {
      currentTool: { name: 'Bash', summary: 'npm test', since: NOW - 3_000 },
      lastActivityAt: NOW - 60_000,
    }),
    { nowMs: NOW, state: 'working', lod: 2 },
  );
  assert.equal(busy.lobes, 0);
});

test('HONESTY · the power-down runs at most once, keyed to the end timestamp', () => {
  // Driven as a sequence of snapshots, the way §5 asks: the strip plays, it
  // reaches frame 5, and it never restarts however many times it is re-drawn.
  const endedAt = NOW;
  const seen = [];
  for (const ms of [0, 200, 400, 800, 1200, 1600, 2000, 60_000, 86_400_000]) {
    seen.push(powerDown(endedAt + ms, endedAt));
  }
  // Monotonically down, and latched at 1 the moment the 1.6 s is up.
  for (let i = 1; i < seen.length; i++) {
    assert.ok(seen[i] >= seen[i - 1], `frame ${i} went back up: ${seen}`);
  }
  assert.equal(seen[seen.length - 1], 1);
  assert.equal(seen[5], 1, 'the strip had not finished at 1.6 s');
  // Frames, not a ramp: five distinct values and no sixth.
  const distinct = new Set(seen.map((v) => Math.round(v * LIFE.power_down.frames)));
  assert.ok(distinct.size <= LIFE.power_down.frames, `${distinct.size} frames, not 5`);

  // And a session that has NOT ended does not power down at all.
  const live = characterLife(agent('a'), { nowMs: NOW, state: 'working', lod: 2 });
  assert.equal(live.power, 0);
});

test('HONESTY · nothing animates on `let_go`', () => {
  // §1.4's list of refusals, verbatim: "no animation at all on `let_go`".
  const life = characterLife(agent('a', { ackState: 'let_go' }), {
    nowMs: NOW,
    state: 'let_go',
    lod: 2,
  });
  assert.equal(life.power, 1, 'a let-go session is drawn down, not animated down');
  assert.equal(life.lobes, 0);
  assert.equal(life.dots, 0);
  assert.equal(life.flicker, 0);
});

test('HONESTY · an ended figure is STILL once its power-down has run (audit F9)', () => {
  // §2's table: `ended` is a slump, "seated, still". Motion ON, two clocks
  // 1.7 s apart, both after the 1.6 s one-shot: the frames are byte-identical —
  // no slump breathing, no antenna bob, no visor blink.
  const ended = agent('e', { activityState: 'ended', lastActivityAt: NOW - 60_000 });
  const at = (now) => drawOne(ended, { now, state: 'ended', clip: 'slump' });
  for (const t of [NOW, NOW + 850, NOW + 3_333]) {
    assert.equal(JSON.stringify(at(t)), JSON.stringify(at(t + 1_700)), `moved at +${t - NOW} ms`);
  }
  const life = characterLife(ended, { nowMs: NOW, state: 'ended', lod: 2 });
  assert.equal(life.still, true);
  // While the one-shot is still playing it is NOT still: the power-down is the
  // one thing an ending figure does.
  const ending = agent('e2', { activityState: 'ended', lastActivityAt: NOW - 300 });
  assert.equal(characterLife(ending, { nowMs: NOW, state: 'ended', lod: 2 }).still, false);
  assert.notEqual(
    JSON.stringify(drawOne(ending, { now: NOW, state: 'ended', clip: 'slump' })),
    JSON.stringify(drawOne(ending, { now: NOW + 900, state: 'ended', clip: 'slump' })),
    'the power-down itself did not play',
  );
  // And a live figure keeps its idle life.
  assert.equal(characterLife(agent('w'), { nowMs: NOW, state: 'working', lod: 2 }).still, false);
});

test('HONESTY · a timestamp the daemon never reported animates nothing', () => {
  assert.equal(sinceS(NOW, undefined), -1);
  assert.equal(sinceS(NOW, null), -1);
  assert.equal(sinceS(NOW, 'yesterday'), -1);
  assert.equal(sinceS(NOW, NOW + 5_000), 0, 'a future instant is now, never a negative phase');
  const noTimes = characterLife(
    { id: 'a', activityState: 'working', ackState: 'active' },
    { nowMs: NOW, state: 'working', lod: 2 },
  );
  assert.equal(noTimes.lobes, 0, 'a cloud grew from a timestamp nobody reported');
});

// ----------------------------------------------------------- 4. the LOD list

test('LOD · the drop list is §1.3’s, and the visor and the hand are on no list', () => {
  assert.deepEqual([...LIFE_DROPPED_AT_L0].sort(), ['page_flip', 'run', 'slump', 'think', 'walk']);
  for (const name of LIFE_NEVER_DROPPED) {
    assert.equal(LIFE[name].minLod, 0, `${name} is in a drop list and must not be`);
    for (const lod of [0, 1, 2]) assert.equal(lifeDrawnAt(name, lod), true);
  }
  for (const name of LIFE_DROPPED_AT_L0) {
    assert.equal(lifeDrawnAt(name, 0), false, `${name} survived L0`);
    assert.equal(lifeDrawnAt(name, 1), true);
  }
});

test('LOD · below the tier only the visor and the hand animate', () => {
  const thinking = agent('a', { lastActivityAt: NOW - 60_000 });
  const l2 = characterLife(thinking, { nowMs: NOW, state: 'working', lod: 2 });
  assert.equal(l2.lobes, 3);
  const l0 = characterLife(thinking, { nowMs: NOW, state: 'working', lod: 0 });
  assert.equal(l0.lobes, 0, 'the thought cloud survived L0');

  const stalled = agent('b', { activityState: 'stalled' });
  assert.ok(characterLife(stalled, { nowMs: NOW, state: 'stalled', lod: 1 }).dots > 0);
  assert.equal(characterLife(stalled, { nowMs: NOW, state: 'stalled', lod: 0 }).dots, 0);

  const review = agent('c', { activityState: 'for_review', reviewSince: NOW - 250 });
  assert.ok(characterLife(review, { nowMs: NOW, state: 'for_review', lod: 1 }).card < 1);
  assert.equal(
    characterLife(review, { nowMs: NOW, state: 'for_review', lod: 0 }).card,
    1,
    'the page flipped at L0',
  );

  // The visor flash is on no drop list at all.
  const flashing = { nowMs: NOW, state: 'working', lod: 0, flickerAt: NOW };
  assert.ok(characterLife(agent('d'), flashing).flicker > 0);
});

// ------------------------------------------------------------- 5. the budget

test('BUDGET · a hundred agents cost a bounded number of draw calls per figure', () => {
  // Draw calls, not milliseconds. A wall-clock assertion in a unit suite fails
  // on a busy runner and says nothing about the commit; the property that
  // actually matters is that the cost is PER FIGURE and bounded, which is what
  // `02-ARCHITECTURE.md` §8's budget is arithmetic over.
  const a = agent('a', { lastActivityAt: NOW - 60_000 });
  const perFigure = (lod) => drawOne(a, { now: NOW, lod, pinned: 0.25 }).length;
  const full = perFigure(2);
  const far = perFigure(0);
  assert.ok(full > 0);
  assert.ok(far < full, `L0 (${far}) is not cheaper than L2 (${full})`);
  // The ceilings are the measured cost plus headroom, not a target: what they
  // catch is a draw that starts scaling with something other than the figure.
  assert.ok(full < 340, `one figure costs ${full} calls at L2`);
  assert.ok(far < 220, `one figure costs ${far} calls at L0`);

  // A hundred of them is a hundred times one of them, and no more: nothing in
  // the character-life director is quadratic in the population.
  const hundred = stubCtx();
  const pose = sampleClip('type', 0.25 * clipDuration('type'), false);
  for (let i = 0; i < 100; i++) {
    const person = agent(`a-${i}`, { lastActivityAt: NOW - 60_000 });
    drawCharacter(hundred, pose, {
      x: 10 + (i % 10) * 30,
      y: 10 + Math.floor(i / 10) * 30,
      u: 24,
      lod: 0,
      color: STATE_COLORS.working,
      state: 'working',
      seconds: NOW / 1000,
      life: characterLife(person, { nowMs: NOW, state: 'working', lod: 0, pinned: 0.25 }),
    });
  }
  assert.ok(
    hundred.calls.length <= far * 100 + 100,
    `a hundred agents cost ${hundred.calls.length} calls, more than a hundred figures' worth`,
  );
});

test('BUDGET · the character-life director allocates nothing per call', () => {
  // The scratch is shared on purpose (see `life.js`'s header). Asserting it
  // that way round is the only way to state the rule: two calls hand back the
  // SAME object, so no caller may hold on to one.
  const first = characterLife(agent('a'), { nowMs: NOW, state: 'working', lod: 2 });
  const second = characterLife(agent('b'), { nowMs: NOW, state: 'working', lod: 2 });
  assert.equal(first, second, 'characterLife allocated a new object per call');
  // …and `REST_LIFE`, the value every caller without a director gets, is frozen
  // so nothing can quietly mutate the default for everybody.
  assert.equal(Object.isFrozen(REST_LIFE), true);
});

// ------------------------------------------------------------- 6. the lounge

test('LOUNGE · the activity is a pure function of identity, bay and cycle', () => {
  for (const bay of Object.keys(BAY_ACTIVITIES)) {
    for (const id of ['claude-code:aaa', 'claude-code:bbb', 'codex:ccc']) {
      const once = loungeActivityFor(id, bay, 0);
      assert.equal(loungeActivityFor(id, bay, 0), once, 'the same call gave two answers');
      assert.ok(
        BAY_ACTIVITIES[bay].includes(once),
        `${id} in the ${bay} bay was dealt "${once}", which is not in that bay`,
      );
      // A different bay is a different deal, which is the point of dealing by
      // bay at all: nobody plays pool in the quiet corner.
      assert.equal(ACTIVITY_BAY[once], bay, `${once} is not a ${bay} activity`);
    }
  }
  // Two tabs on one floor: same id, same bay, same cycle, same answer.
  assert.equal(
    loungeActivityFor('claude-code:aaa', 'games', 3),
    loungeActivityFor('claude-code:aaa', 'games', 3),
  );
  // And the hold is 45–90 s, from the same hash, never a roll.
  for (const cycle of [0, 1, 2, 17, 300]) {
    const ms = loungeHoldMs('claude-code:aaa', cycle);
    assert.ok(ms >= 45_000 && ms <= 90_000, `hold ${ms} ms is outside 45–90 s`);
    assert.equal(loungeHoldMs('claude-code:aaa', cycle), ms);
  }
});

test('LOUNGE · every bay activity is a real clip, and every clip has a bay', () => {
  for (const [bay, list] of Object.entries(BAY_ACTIVITIES)) {
    assert.ok(list.length > 0, `the ${bay} bay deals nothing`);
    for (const name of list) assert.ok(CLIPS[name], `${bay} deals "${name}", which is not a clip`);
  }
  for (const [activity, bay] of Object.entries(ACTIVITY_BAY)) {
    assert.ok(CLIPS[activity], `${activity} has a bay but no clip`);
    assert.ok(BAY_ACTIVITIES[bay], `${activity} names bay "${bay}", which does not exist`);
  }
});

test('LOUNGE · the plan tells every spot which bay it stands in', () => {
  // The choice above is only honest if a spot knows its bay; before WP-87 the
  // quiet corner and the sofas were both `lounge_idle` and indistinguishable.
  const benched = Array.from({ length: 12 }, (_, i) =>
    agent(`b-${i}`, { ackState: 'benched', lastActivityAt: NOW - 3_600_000 }),
  );
  const plan = buildPlan([{ id: 'p0', name: 'deckhq', sessionCount: 12 }], benched, {
    targetAspect: 1.6,
    now: NOW,
  });
  const spots = plan.loungeSpots || [];
  assert.ok(spots.length > 0, 'a lounge with twelve people in it laid no places');
  for (const spot of spots) {
    assert.ok(spot.bay, `spot ${spot.id} (${spot.kind}) has no bay`);
    assert.ok(BAY_ACTIVITIES[spot.bay], `spot ${spot.id} names bay "${spot.bay}"`);
    assert.ok(
      BAY_ACTIVITIES[spot.bay].includes(spot.kind),
      `spot ${spot.id} is a ${spot.kind} in the ${spot.bay} bay, which does not deal one`,
    );
  }
});

// -------------------------------------------------------- 7. walk versus run

test('RUN · the only trip that runs is `needs_input` going to Your Office', () => {
  // §2, and it is the one claim rather than a state.
  assert.equal(tripRuns('office', agent('a', { activityState: 'needs_input' })), true);
  assert.equal(
    tripRuns('office', agent('a', { activityState: 'for_review' })),
    false,
    'for_review walks: it is waiting on you, but it is not blocked mid-turn',
  );
  assert.equal(tripRuns('office', agent('a', { activityState: 'stalled' })), false);
  assert.equal(
    tripRuns('desk', agent('a', { activityState: 'needs_input' })),
    false,
    'a trip to a desk is never a run, whatever the state',
  );
  assert.equal(tripRuns('lounge', agent('a', { activityState: 'needs_input' })), false);
  assert.equal(
    tripRuns('office', agent('a', { activityState: 'needs_input', ackState: 'benched' })),
    false,
    'a benched session is not waiting on you',
  );
  assert.equal(tripRuns('office', null), false);
});

test('RUN · a run covers more ground per second than a walk, in the document’s ratio', () => {
  assert.ok(RUN_SPEED > WALK_SPEED);
  // §2's own 4.6 : 2.6, to within the rounding a whole number of units costs.
  assert.ok(Math.abs(RUN_SPEED / WALK_SPEED - 4.6 / 2.6) < 0.05);
  assert.equal(LIFE.run.frames, 4);
  assert.equal(LIFE.walk.frames, 2);
  assert.ok(LIFE.run.period < LIFE.walk.period, 'a run cycles slower than a walk');
});

// --------------------------------------------------- the table, as the table

test('§2’s table is the table: every animation at its stated frames and period', () => {
  /** `docs/plan/12-MOTION-AND-CREW.md` §2, verbatim. */
  const SPEC = {
    type: [4, 0.9],
    visor_flicker: [3, 0.24],
    think: [4, 3.2],
    wave: [4, 1.4],
    page_flip: [4, 0.5],
    slump: [3, 4.0],
    power_down: [5, 1.6],
    walk: [2, 0.8],
    run: [4, 0.52],
    spawn: [3, 0.32],
    despawn: [3, 0.42],
  };
  assert.deepEqual(Object.keys(LIFE).sort(), Object.keys(SPEC).sort());
  for (const [name, [frames, period]] of Object.entries(SPEC)) {
    assert.equal(LIFE[name].frames, frames, `${name}.frames`);
    assert.equal(LIFE[name].period, period, `${name}.period`);
  }
  // The three that are also clips must agree with `clips.js` about the period,
  // or the pose and the director would be animating at two different speeds.
  assert.equal(CLIPS.type.duration, LIFE.type.period);
  assert.equal(CLIPS.think.duration, LIFE.think.period);
  assert.equal(CLIPS.hand_raise.duration, LIFE.wave.period);
  assert.equal(CLIPS.slump.duration, LIFE.slump.period);
  assert.equal(CLIPS.walk.duration, LIFE.walk.period);
  assert.equal(CLIPS.run.duration, LIFE.run.period);
});

test('a strip is frames, not a blend', () => {
  for (const [name, spec] of Object.entries(LIFE)) {
    const seen = new Set();
    for (let i = 0; i < 200; i++) seen.add(lifeFrame(i / 200, spec.frames));
    assert.equal(seen.size, spec.frames, `${name} resolved to ${seen.size} frames`);
    assert.equal(lifeFrame(0, spec.frames), 0);
    assert.equal(lifeFrame(0.999999, spec.frames), spec.frames - 1);
    // Out of range, and not a number, never throw and never leave the strip.
    assert.equal(lifeFrame(-0.25, spec.frames) >= 0, true);
    assert.equal(lifeFrame(NaN, spec.frames), 0);
  }
});

test('the page flip is one flip of half a second every twelve, and flat in between', () => {
  assert.equal(pageFlip(0), 1, 'flat on the first frame');
  assert.equal(pageFlip(0.25), 0, 'edge-on a quarter of the way through the flip');
  assert.equal(pageFlip(0.6), 1, 'flat again once the half second is up');
  assert.equal(pageFlip(11.9), 1);
  assert.equal(pageFlip(12.25), 0, 'the next flip, twelve seconds on');
  assert.equal(pageFlip(-1), 1, 'a review that has not started is held flat');
});

test('spawn pops in and despawn folds away, both once and both in three frames', () => {
  const grow = [0, 0.1, 0.2, 0.31, 0.5].map((s) => oneShot(NOW + s * 1000, NOW, 'spawn'));
  for (let i = 1; i < grow.length; i++) assert.ok(grow[i] >= grow[i - 1]);
  assert.equal(grow[grow.length - 1], 1, 'the pop-in never finished');
  assert.equal(new Set(grow).size <= LIFE.spawn.frames, true);

  const fold = [0, 0.14, 0.28, 0.41, 1].map((s) => oneShot(NOW + s * 1000, NOW, 'despawn'));
  assert.equal(fold[fold.length - 1], 1);
  assert.equal(new Set(fold).size <= LIFE.despawn.frames, true);
});

test('a figure that has left the snapshot is kept just long enough to fold away', () => {
  const plan = buildPlan(
    [{ id: 'p0', name: 'deckhq', sessionCount: 2 }],
    [agent('a'), agent('b')],
    {
      targetAspect: 1.6,
      now: NOW,
    },
  );
  const runtime = new AgentRuntime();
  const both = [agent('a'), agent('b')];
  runtime.sync(both, plan, assignSeats(plan, both), { now: NOW });
  assert.equal(runtime.size, 2);

  const one = [agent('a')];
  runtime.sync(one, plan, assignSeats(plan, one), { now: NOW + 100 });
  assert.equal(runtime.size, 2, 'the departing figure vanished instead of folding away');
  assert.equal(runtime.get('b').leftAt, NOW + 100);

  runtime.sync(one, plan, assignSeats(plan, one), { now: NOW + 100 + LIFE.despawn.period * 1000 });
  assert.equal(runtime.size, 1, 'the departed record was never collected');

  // With no injected clock there is nothing to time a fold with, so the record
  // goes the frame it always did — every caller that predates WP-87.
  const untimed = new AgentRuntime();
  untimed.sync(both, plan, assignSeats(plan, both));
  untimed.sync(one, plan, assignSeats(plan, one));
  assert.equal(untimed.size, 1);
});

test('the population a tab opens onto is present, not a hundred arrivals', () => {
  const agents = Array.from({ length: 4 }, (_, i) => agent(`a-${i}`));
  const plan = buildPlan([{ id: 'p0', name: 'deckhq', sessionCount: 4 }], agents, {
    targetAspect: 1.6,
    now: NOW,
  });
  const runtime = new AgentRuntime();
  // `Scene#setState` syncs the PREVIOUS agent list first, to bridge the
  // re-plan, and on the first snapshot that list is empty. An empty sync must
  // not count as "the floor has had a population" — when it did, the whole
  // demo floor arrived at once and `demo@motion` photographed twenty-seven
  // robots at a third of their size.
  runtime.sync([], plan, assignSeats(plan, []), { now: NOW });
  runtime.sync(agents, plan, assignSeats(plan, agents), { now: NOW });
  for (const rec of runtime.all()) assert.equal(rec.spawnAt, null, 'the first snapshot popped in');

  const more = [...agents, agent('a-new')];
  runtime.sync(more, plan, assignSeats(plan, more), { now: NOW + 5_000 });
  assert.equal(runtime.get('a-new').spawnAt, NOW + 5_000, 'a genuine arrival did not pop in');
  assert.equal(runtime.get('a-0').spawnAt, null);
});

test('a clip phase comes off the agent’s own timestamps, not off when this tab noticed', () => {
  // §1.1: "so two tabs draw the same frame and a reload does not restart a
  // cycle". Two runtimes, two different "now"s, one agent — same phase.
  const waiting = agent('a', {
    activityState: 'needs_input',
    needsInputSince: NOW - 40_000,
    lastActivityAt: NOW - 40_000,
  });
  const plan = buildPlan([{ id: 'p0', name: 'deckhq', sessionCount: 1 }], [waiting], {
    targetAspect: 1.6,
    now: NOW,
  });
  const one = new AgentRuntime();
  const two = new AgentRuntime();
  one.sync([waiting], plan, assignSeats(plan, [waiting]), { now: NOW });
  two.sync([waiting], plan, assignSeats(plan, [waiting]), { now: NOW + 9_000 });
  assert.equal(one.get('a').clipStartedAt, NOW - 40_000);
  assert.equal(
    one.get('a').clipStartedAt,
    two.get('a').clipStartedAt,
    'two tabs disagreed about which frame of the wave they were on',
  );
});
