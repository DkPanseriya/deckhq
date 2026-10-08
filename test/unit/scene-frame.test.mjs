/**
 * A FRAME COSTS WHAT MOVED IN IT (`public/render/scene-frame.js`,
 * `scene-static.js`).
 *
 * The floor drew every frame from nothing: every badge measured, every plate
 * laid out, every name placed round every body, and the ground painted under
 * all of it, sixty times a second whether or not anything had changed. Now the
 * layout is kept while its inputs hold, the ground is composed once per
 * camera, and a frame that would be the picture already on the canvas is not
 * drawn. Each of those is only right if "the same" means the same, so that is
 * what is held here, with no canvas:
 *
 *   - a kept layout is, value for value, the layout measured again;
 *   - it is measured again when a figure moves, the selection changes, a
 *     snapshot arrives or a wait crosses a minute — and not otherwise;
 *   - with motion on, a clock that moved is a frame and a pinned clock is none;
 *   - under reduced motion nothing is drawn until something the still frame
 *     shows has changed.
 *
 * The pixels themselves — the composed ground against the ground painted
 * directly — need a browser: `scripts/render-bench.mjs` draws both and counts
 * the pixels that differ.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { InputTape, SceneFrame, waitMinute } from '../../public/render/scene-frame.js';
import { groundKey } from '../../public/render/scene-static.js';
import {
  Scene,
  joinPlanSignature,
  planSignature,
  planSignatureParts,
} from '../../public/render/scene.js';
import { AgentRuntime } from '../../public/render/agents.js';
import { rigTints, shade } from '../../public/render/rig-metrics.js';
import { drawHaloPool } from '../../public/render/rig-body.js';
import { buildPlan } from '../../public/render/plan.js';
import { assignSeats } from '../../public/render/agents.js';
import { computeFill } from '../../public/render/scene-camera.js';
import { crewsFrom, floorPopulation } from '../../public/floor-rule.js';
import { adoptSnapshotClock } from '../../public/clock.js';
import { forgetTextMetrics } from '../../public/render/text-metrics.js';
import { LARGE_NOW, largeFloor } from '../helpers/large-floor.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MINUTE = 60_000;

/** Measures like a canvas, and counts how often it was asked. */
function measuringCtx() {
  return {
    font: '10px x',
    measured: 0,
    measureText(text) {
      this.measured++;
      const px = parseFloat(/(\d[\d.]*)px/.exec(this.font)?.[1] ?? '10');
      return { width: String(text).length * px * 0.58 };
    },
  };
}

/**
 * The large demo floor as a scene holds it, with no canvas: the real plan, the
 * real seats, and exactly the fields a frame reads.
 */
function sceneAt(viewW = 2000, viewH = 1055) {
  adoptSnapshotClock({ now: LARGE_NOW, nowFixed: true });
  const { projects, agents } = largeFloor();
  const plan = buildPlan(projects, agents, { stage: { w: viewW, h: viewH }, now: LARGE_NOW });
  const seats = assignSeats(plan, agents);
  const { scale } = computeFill(plan.width, plan.height, viewW, viewH);
  const pop = floorPopulation(agents, { now: LARGE_NOW });
  const records = agents
    .filter((a) => seats.has(a.id))
    .map((a) => ({
      ...seats.get(a.id),
      id: a.id,
      targetSeat: seats.get(a.id),
      agent: a,
      path: [],
      clip: 'type',
      clipStartedAt: LARGE_NOW - 5000,
      placement: 'desk',
      seated: true,
      angle: 0,
    }));
  const scene = Object.create(SceneFrame.prototype);
  Object.assign(scene, {
    canvas: { width: viewW, height: viewH },
    _dpr: 1,
    _camera: { panX: 0, panY: 0 },
    _fitScale: scale,
    _zoom: 1,
    _reduced: false,
    _phase: null,
    _snapshot: { projects, agents, counts: { drawn: { waiting: pop.waiting } } },
    _plan: plan,
    _backdrop: {},
    _detail: null,
    _fadeFrom: null,
    _selectedId: null,
    _hoveredTarget: null,
    _agentsById: new Map(agents.map((a) => [a.id, a])),
    _crewCounts: new Map(crewsFrom(agents, { now: LARGE_NOW }).map((c) => [c.parentId, c.count])),
    _runtime: { all: () => records, get: (id) => records.find((r) => r.id === id) },
    _stateGen: 1,
    _paintGen: 0,
    _drawnDirect: false,
    _layout: null,
    _layoutTape: null,
    _frameTape: null,
  });
  const camera = scene._cameraParams();
  return { scene, records, camera, agents, viewW, viewH };
}

const at = (ms) => adoptSnapshotClock({ now: ms, nowFixed: true });

// ------------------------------------------------------------------ the tape

test('a tape is the same only when every value on it is, in order', () => {
  const tape = new InputTape();
  const a = {};
  const b = {};
  const write = (nums, refs) => {
    tape.begin();
    for (const n of nums) tape.num(n);
    for (const r of refs) tape.ref(r);
    return tape.end();
  };
  assert.equal(write([1, 2, 3], [a, 'x']), false, 'the first list is a new one');
  assert.equal(write([1, 2, 3], [a, 'x']), true);
  assert.equal(write([1, 2, 4], [a, 'x']), false, 'one number moved');
  assert.equal(write([1, 2, 4], [a, 'x']), true);
  assert.equal(write([1, 2, 4], [b, 'x']), false, 'another object');
  assert.equal(write([1, 2, 4], [b, 'y']), false, 'another string');
  assert.equal(write([1, 2, 4], [b, 'y', null]), false, 'one reference more');
  assert.equal(write([1, 2, 4], [b, 'y']), false, 'one reference fewer');
  assert.equal(write([1, 2], [b, 'y']), false, 'one number fewer');
  assert.equal(write([1, 2, 9], [b, 'y']), false, 'one number more');
  assert.equal(write([NaN, Infinity], []), false);
  assert.equal(write([NaN, Infinity], []), true, 'NaN is the NaN written before');
  tape.forget();
  assert.equal(write([NaN, Infinity], []), false, 'forgotten: a new list whatever it says');
  assert.equal(write([NaN, Infinity], []), true);
  // Long enough to grow, and still exact at the far end.
  const long = Array.from({ length: 5000 }, (_, i) => i * 0.5);
  assert.equal(write(long, []), false);
  assert.equal(write(long, []), true);
  assert.equal(write([...long.slice(0, 4999), -1], []), false);
});

test('a wait is in the minute its badge prints, and no finer', () => {
  assert.equal(waitMinute(1000 * MINUTE, 1000 * MINUTE - 1), 0);
  assert.equal(waitMinute(1000 * MINUTE, 999 * MINUTE + 1), 0);
  assert.equal(waitMinute(1000 * MINUTE, 999 * MINUTE), 1);
  assert.equal(waitMinute(1000 * MINUTE, 880 * MINUTE), 120);
  // No wait, a clock behind the timestamp, and no timestamp are three answers:
  // a plate asks whether the wait is over zero, and which of two agents waited
  // longer.
  assert.equal(waitMinute(5, 5), -1);
  assert.equal(waitMinute(5, 6), -2);
  for (const none of [null, undefined, NaN, Infinity, '5']) assert.equal(waitMinute(5, none), -3);
});

test('the ground is composed again for a camera, a canvas or a palette — and for nothing else', () => {
  const base = {
    canvasW: 2000,
    canvasH: 1055,
    dpr: 1,
    viewW: 2000,
    viewH: 1055,
    panX: 12,
    panY: 0,
    zoom: 0.66,
    scale: 9.32,
    planW: 212,
    planH: 113,
    wash: 'rgba(0,0,0,0.2)',
    shadow: 'rgba(0,0,0,0.3)',
    ground: '#E9E4DA',
  };
  const key = groundKey(base);
  assert.equal(groundKey({ ...base }), key);
  for (const [field, value] of Object.entries({
    canvasW: 2001,
    canvasH: 1054,
    dpr: 2,
    viewW: 1999.5,
    viewH: 1055.5,
    panX: 13,
    panY: 1,
    zoom: 0.67,
    scale: 9.4,
    planW: 213,
    planH: 114,
    wash: 'rgba(0,0,0,0.25)',
    shadow: 'rgba(0,0,0,0.35)',
    ground: '#101418',
  })) {
    assert.notEqual(groundKey({ ...base, [field]: value }), key, `${field} is in the key`);
  }
});

// ---------------------------------------------------------------- the layout

test('a kept layout is the layout measured again, and costs no measuring', () => {
  const { scene, records, camera, viewW, viewH } = sceneAt();
  const ctx = measuringCtx();
  const shown = scene._frameRecords(camera, viewW, viewH);
  assert.equal(shown.length, records.length);
  const first = scene._layoutFrame(ctx, shown, camera);
  const measured = ctx.measured;
  assert.ok(measured > 100, `a 150-agent floor measured ${measured} strings once`);
  assert.ok(first.labels.plan.size > 50);
  assert.ok(first.plates.size > 20);
  for (let i = 0; i < 20; i++) {
    assert.equal(scene._layoutFrame(ctx, scene._frameRecords(camera, viewW, viewH), camera), first);
  }
  assert.equal(ctx.measured, measured, 'twenty frames more measured nothing');
  // And it is what a frame that kept nothing would have laid out.
  forgetTextMetrics();
  const again = scene._measureFrame(measuringCtx(), shown, camera, first.charU);
  assert.deepEqual(again, first);
});

test('the layout is measured again when one of its inputs moves, and only then', () => {
  const { scene, records, camera, viewW, viewH, agents } = sceneAt();
  const ctx = measuringCtx();
  const lay = () => scene._layoutFrame(ctx, scene._frameRecords(camera, viewW, viewH), camera);
  let kept = lay();
  /** @param {string} why @param {() => void} change */
  const moves = (why, change) => {
    assert.equal(lay(), kept, `${why}: kept until it happens`);
    change();
    const next = lay();
    assert.notEqual(next, kept, `${why}: laid out again`);
    kept = next;
  };
  moves('a figure took a step', () => (records[3].x += 0.25));
  moves('a figure was given another seat', () => {
    records[5].targetSeat = { ...records[5].targetSeat };
  });
  moves('somebody was selected', () => (scene._selectedId = records[0].id));
  moves('a snapshot arrived', () => scene._stateGen++);
  moves('the palette was repainted', () => scene._paintGen++);
  moves('the floor was magnified', () => (scene._zoom = 1.5));
  moves('a font finished loading', () => forgetTextMetrics());
  // The clock: nothing for most of a minute, then the minute.
  const waiting = agents.find((a) => a.activityState === 'for_review' && a.reviewSince);
  assert.ok(waiting, 'the fixture has somebody waiting');
  const waited = LARGE_NOW - waiting.reviewSince;
  const toNext = MINUTE - (waited % MINUTE);
  at(LARGE_NOW + toNext - 1);
  assert.equal(lay(), kept, 'a millisecond short of the minute: the same badges');
  moves('a wait crossed into its next minute', () => at(LARGE_NOW + toNext));
  at(LARGE_NOW);
});

// ------------------------------------------------------------- is a frame due

test('with motion on, a clock that moved is a frame and a pinned clock is none', () => {
  const { scene, records } = sceneAt();
  assert.equal(scene._frameDue(), true, 'the first frame is always drawn');
  for (let i = 0; i < 10; i++) assert.equal(scene._frameDue(), false, 'pinned: nothing to draw');
  at(LARGE_NOW + 16);
  assert.equal(scene._frameDue(), true, 'the clock moved, so every figure did');
  assert.equal(scene._frameDue(), false);
  records[7].x += 0.1;
  assert.equal(scene._frameDue(), true, 'somebody walked');
  records[7].clip = 'think';
  assert.equal(scene._frameDue(), true, 'somebody changed what they are doing');
  scene._hoveredTarget = { kind: 'new-agent', id: 'orbital-api' };
  assert.equal(scene._frameDue(), true, 'the pointer is over a room’s +');
  scene._hoveredTarget = { kind: 'new-agent', id: 'orbital-api' };
  assert.equal(scene._frameDue(), false, 'the same + again is the same picture');
  scene._backdrop = {};
  assert.equal(scene._frameDue(), true, 'the floor was baked again');
  scene.canvas.width += 1;
  assert.equal(scene._frameDue(), true, 'the canvas was resized, which clears it');
  assert.equal(scene._frameDue(), false);
  at(LARGE_NOW);
});

test('a frame drawn outside the loop, and every frame of a cross-fade, makes the next one due', () => {
  const { scene } = sceneAt();
  scene._frameDue();
  assert.equal(scene._frameDue(), false);
  // `setState` on a hidden tab, a selection, a resize: `_draw()` called directly.
  scene._drawnDirect = true;
  assert.equal(scene._frameDue(), true);
  assert.equal(scene._drawnDirect, false);
  assert.equal(scene._frameDue(), false);
  scene._fadeFrom = { backdrop: {} };
  for (let i = 0; i < 5; i++) assert.equal(scene._frameDue(), true, 'a fade is a new picture');
  // The fade is ended by the frame that finds it over, which is drawn without
  // it: that frame is the picture, and nothing is due after it.
  scene._fadeFrom = null;
  assert.equal(scene._frameDue(), false);
});

test('under reduced motion nothing is drawn until the still frame would change', () => {
  const { scene, records, agents } = sceneAt();
  scene._reduced = true;
  assert.equal(scene._frameDue(), true);
  // Two seconds of frames with the clock running and nobody moving. The bound
  // is the nearest thing the clock can change: a wait's next minute, or a
  // thought's next lobe.
  let drawn = 0;
  for (let ms = 16; ms <= 2000; ms += 16) {
    at(LARGE_NOW + ms);
    if (scene._frameDue()) drawn++;
  }
  // A thought grows a lobe at 2, 6 and 15 s of quiet; the fixture's working
  // agents went quiet a minute ago, and its juniors five seconds ago.
  assert.ok(drawn <= 2, `drew ${drawn} frames in two seconds of nothing happening`);
  // A wait crossing a minute is a new badge and a new plate line.
  const waiting = agents.find((a) => a.activityState === 'for_review' && a.reviewSince);
  const toNext = MINUTE - ((LARGE_NOW - waiting.reviewSince) % MINUTE);
  at(LARGE_NOW + toNext - 1);
  scene._frameDue();
  assert.equal(scene._frameDue(), false);
  at(LARGE_NOW + toNext);
  assert.equal(scene._frameDue(), true, 'the minute turned over');
  assert.equal(scene._frameDue(), false);
  records[2].y += 0.5;
  assert.equal(scene._frameDue(), true, 'reduced motion still walks people to their seats');
  scene._reduced = false;
  assert.equal(scene._frameDue(), true, 'motion came back on');
  at(LARGE_NOW);
});

test('an empty floor is not redrawn by a clock nobody is on', () => {
  const { scene, records } = sceneAt();
  records.length = 0;
  scene._snapshot = { projects: [], agents: [], counts: {} };
  assert.equal(scene._frameDue(), true);
  at(LARGE_NOW + 5000);
  assert.equal(scene._frameDue(), false, 'motion on, and nobody to move');
  at(LARGE_NOW);
});

// ------------------------------------------------------------------ the loop

test('the loop asks before it draws, and the frame paints the ground through its layer', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/render/scene-draw.js'), 'utf8');
  const frame = /\n {2}_frame\(t\) \{[\s\S]*?\n {2}\}\n/.exec(src);
  assert.ok(frame, '_frame is where it was');
  assert.match(frame[0], /if \(this\._frameDue\(\)\) \{\s*this\._draw\(\);/);
  // A frame that threw is drawn again rather than left half-painted.
  assert.match(frame[0], /catch \(err\) \{[\s\S]*?this\._drawnDirect = true;/);
  const draw = /\n {2}_draw\(\) \{[\s\S]*?\n {2}\}\n/.exec(src);
  assert.ok(draw);
  assert.match(draw[0], /this\._drawnDirect = true;/);
  assert.match(draw[0], /this\._drawGround\(ctx, viewW, viewH, camera\)/);
  assert.match(draw[0], /this\._layoutFrame\(ctx, records, camera\)/);
  // Nothing in a frame fills the canvas with a gradient or measures a string.
  assert.doesNotMatch(draw[0], /fillRect\(0, 0, viewW, viewH\)|measureText\(/);
});

// ------------------------------------------- a theme is paint, and not a plan

test('a snapshot whose only news is its theme is baked, not planned again', () => {
  adoptSnapshotClock({ now: LARGE_NOW, nowFixed: true });
  const { projects, agents } = largeFloor();
  const base = { projects, agents, counts: {}, settings: { theme: 'default' } };
  // The signature is the string it always was, in two halves.
  const parts = planSignatureParts(base);
  assert.equal(joinPlanSignature(parts), planSignature(base));
  assert.equal(parts.theme, 'tdefault');
  assert.equal(planSignature(base).split('~').indexOf('tdefault'), 5, 'the theme is where it was');
  const themed = { ...base, settings: { theme: 'night-shift' } };
  assert.notEqual(planSignature(themed), planSignature(base));
  assert.deepEqual(planSignatureParts(themed).geometry, parts.geometry);
  // A look moves planting and the lounge's kit, which is geometry.
  const looked = { ...base, settings: { theme: 'default', look: { lounge: { arcade: false } } } };
  assert.notDeepEqual(planSignatureParts(looked).geometry, parts.geometry);
  // And so is somebody being benched.
  const benched = {
    ...base,
    agents: agents.map((a, i) => (i === 0 ? { ...a, ackState: 'benched' } : a)),
  };
  assert.notDeepEqual(planSignatureParts(benched).geometry, parts.geometry);

  // The scene, with the two expensive things counted.
  const scene = Object.create(Scene.prototype);
  let plans = 0;
  let bakes = 0;
  Object.assign(scene, {
    canvas: { setAttribute() {} },
    _snapshot: { agents: [], projects: [], counts: {} },
    _viewW: 2000,
    _viewH: 1055,
    _plan: null,
    _planSignature: null,
    _planGeometry: null,
    _runtime: new AgentRuntime(),
    _selectedId: null,
    _running: true,
    _stateGen: 0,
    _paintGen: 0,
    _fadeFrom: null,
    _rebuildPlan() {
      plans++;
      this._plan = buildPlan(this._snapshot.projects, this._snapshot.agents, {
        stage: { w: 2000, h: 1055 },
        now: LARGE_NOW,
      });
    },
    _bakeFloor() {
      bakes++;
    },
    _draw() {},
  });
  scene.setState(base);
  assert.deepEqual([plans, bakes], [1, 0]);
  const plan = scene._plan;
  const seated = [...scene._runtime.all()].map((r) => [r.id, r.x, r.y]);
  scene._fadeFrom = { backdrop: {} };
  scene.setState(themed);
  assert.deepEqual([plans, bakes], [1, 1], 'a theme: one bake, no plan');
  assert.equal(scene._plan, plan, 'the same building');
  assert.equal(scene._fadeFrom, null, 'and no cross-fade between a floor and itself');
  assert.equal(scene._paintGen, 1, 'the frame is laid out in the new palette');
  assert.deepEqual(
    [...scene._runtime.all()].map((r) => [r.id, r.x, r.y]),
    seated,
    'nobody moved',
  );
  scene.setState(themed);
  assert.deepEqual([plans, bakes], [1, 1], 'the same snapshot again is neither');
  scene.setState(looked);
  assert.deepEqual([plans, bakes], [2, 1], 'a look is a new building');
  scene.setState(base);
  assert.equal(plans, 3);
});

// ------------------------------------------------------- what the rig keeps

test('a figure’s five tints are worked out once per colour, and are the same five', () => {
  const live = rigTints('#3A7D5B', false);
  assert.equal(rigTints('#3A7D5B', false), live, 'asked again: the same answer, not a new one');
  assert.deepEqual(
    { ...live },
    {
      col: '#3A7D5B',
      shell: shade('#3A7D5B', 0.58),
      lite: shade('#3A7D5B', 0.24),
      dark: shade('#3A7D5B', -0.2),
      deep: shade('#3A7D5B', -0.34),
      glass: shade('#3A7D5B', -0.6),
      dead: false,
    },
  );
  const dead = rigTints('#3A7D5B', true);
  assert.notEqual(dead, live);
  assert.equal(dead.dead, true);
  assert.equal(dead.shell, live.shell);
  assert.ok(Object.isFrozen(live), 'shared, so nobody may write to it');
  assert.notEqual(rigTints('#B5452F', false).dark, live.dark);
});

test('the pool under a figure standing still is one gradient, not one a frame', () => {
  const made = [];
  const ctx = {
    fillStyle: '',
    createRadialGradient(...at) {
      const g = { at, stops: [], addColorStop: (o, c) => g.stops.push([o, c]) };
      made.push(g);
      return g;
    },
    beginPath() {},
    arc() {},
    fill() {},
  };
  drawHaloPool(ctx, 120.5, 300.25, 20);
  const first = ctx.fillStyle;
  assert.equal(made.length, 1);
  assert.deepEqual(first.at.slice(0, 2), [120.5, 300.25], 'at the figure’s own point');
  assert.equal(first.stops.length, 2);
  for (let i = 0; i < 60; i++) drawHaloPool(ctx, 120.5, 300.25, 20);
  assert.equal(made.length, 1, 'sixty frames, one gradient');
  assert.equal(ctx.fillStyle, first);
  drawHaloPool(ctx, 121, 300.25, 20);
  assert.equal(made.length, 2, 'a step sideways is another paint');
  drawHaloPool(ctx, 120.5, 300.25, 24);
  assert.equal(made.length, 3, 'and so is another size');
  assert.deepEqual(made[2].at, [120.5, 300.25, 0, 120.5, 300.25, made[2].at[5]]);
  // Another canvas is another set of paints.
  const other = { ...ctx };
  drawHaloPool(other, 120.5, 300.25, 20);
  assert.equal(made.length, 4);
});
