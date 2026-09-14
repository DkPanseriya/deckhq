import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BODY_HEIGHT_U,
  RIG_DETAIL_MIN_PX,
  RIG_POSES,
  RIG_STATES,
  RIG_UNIT_U,
  drawCharacter,
  drawManagerFigure,
  handTop,
  idlePhase,
  makePose,
  rigDetail,
  rigHeight,
  rigPoseFor,
  walkFrame,
} from '../../public/render/rig.js';
import { STATE_COLORS, identityFor, appearanceFor } from '../../public/render/palette.js';
import { sampleClip, CLIPS } from '../../public/render/clips.js';

/**
 * WP-79's rig, measured from the draw calls it actually issues.
 *
 * This file used to prove the opposite property. The old rig ROTATED with
 * `pose.bodyAngle`, its local frame faced local -y while `bodyAngle` measured
 * from +x, and the quarter-turn correction between the two produced this
 * renderer's worst bug: a head on one side and the hands on the other
 * (docs/DEVIATIONS.md §26). B is BILLBOARDED — it never turns at all — so the
 * correction is gone and with it the whole class of defect. What is measured
 * here now is that it is really gone (the figure is byte-identical at every
 * facing), plus the five properties the new figure has to hold:
 *
 *   1. every state gets a DIFFERENT pose;
 *   2. the raised hand clears the body's top, at every level of detail;
 *   3. the level-of-detail drop list is exactly the design README's;
 *   4. reduced motion contributes exactly zero phase;
 *   5. the same id draws byte-identically twice.
 *
 * `drawCharacter` computes screen coordinates by hand rather than issuing
 * `ctx.translate`/`ctx.rotate` per part (see its performance-discipline doc
 * comment in rig.js), so every point it hands to `ctx.arc`/`ctx.moveTo`/etc.
 * already IS the final screen coordinate under the identity transform. The
 * fake context below still tracks a real `save`/`restore`/`translate`/
 * `rotate`/`scale` matrix and applies it to every recorded point, so this
 * file keeps working unchanged if the implementation ever moves to
 * `ctx.translate`/`ctx.rotate` instead.
 */

// ---------------------------------------------------------- fake 2D context

/** @returns {{a:number,b:number,c:number,d:number,e:number,f:number}} identity matrix */
function identity() {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

/** `m` post-composed with `delta`: a point now goes through `delta` first, then `m`. */
function compose(m, delta) {
  return {
    a: m.a * delta.a + m.c * delta.b,
    b: m.b * delta.a + m.d * delta.b,
    c: m.a * delta.c + m.c * delta.d,
    d: m.b * delta.c + m.d * delta.d,
    e: m.a * delta.e + m.c * delta.f + m.e,
    f: m.b * delta.e + m.d * delta.f + m.f,
  };
}

function applyPoint(m, x, y) {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

/**
 * A minimal CanvasRenderingContext2D stand-in: no rendering, just an
 * `a..f` CTM and a flat log of every point-bearing call, recorded in *world*
 * (post-transform) coordinates together with the fill/stroke style in force.
 * @returns {{calls: Array<object>, ctx: object}}
 */
function makeFakeCtx() {
  const calls = [];
  let m = identity();
  const stack = [];
  const style = () => ({ fill: ctx.fillStyle, stroke: ctx.strokeStyle, lw: ctx.lineWidth });
  const ctx = {
    save() {
      stack.push(m);
    },
    restore() {
      if (stack.length) m = stack.pop();
    },
    translate(tx, ty) {
      m = compose(m, { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty });
    },
    rotate(theta) {
      const c = Math.cos(theta),
        s = Math.sin(theta);
      m = compose(m, { a: c, b: s, c: -s, d: c, e: 0, f: 0 });
    },
    scale(sx, sy) {
      m = compose(m, { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 });
    },
    // WP-85a: the figure halo's ground pool is a radial gradient fill.
    createRadialGradient() {
      return { addColorStop() {} };
    },
    beginPath() {
      calls.push({ kind: 'beginPath' });
    },
    closePath() {},
    fill() {
      calls.push({ kind: 'fill', ...style() });
    },
    stroke() {
      calls.push({ kind: 'stroke', ...style() });
    },
    fillRect(x, y, w, h) {
      const p = applyPoint(m, x, y);
      calls.push({ kind: 'fillRect', w, h, ...p, ...style() });
    },
    strokeRect() {},
    moveTo(x, y) {
      calls.push({ kind: 'moveTo', ...applyPoint(m, x, y) });
    },
    lineTo(x, y) {
      calls.push({ kind: 'lineTo', ...applyPoint(m, x, y) });
    },
    quadraticCurveTo(cx, cy, x, y) {
      calls.push({ kind: 'quadraticCurveTo', ...applyPoint(m, x, y) });
    },
    arc(x, y, r) {
      calls.push({ kind: 'arc', r, ...applyPoint(m, x, y), ...style() });
    },
    ellipse(x, y, rx, ry) {
      calls.push({ kind: 'ellipse', rx, ry, ...applyPoint(m, x, y), ...style() });
    },
    fillText(text, x, y) {
      calls.push({ kind: 'fillText', text, ...applyPoint(m, x, y) });
    },
    strokeText(text, x, y) {
      calls.push({ kind: 'strokeText', text, ...applyPoint(m, x, y) });
    },
    measureText(text) {
      return { width: String(text).length * 6 };
    },
  };
  for (const prop of [
    'fillStyle',
    'strokeStyle',
    'lineWidth',
    'lineCap',
    'lineJoin',
    'miterLimit',
    'globalAlpha',
    'font',
    'textAlign',
    'textBaseline',
  ]) {
    ctx[prop] = null;
  }
  return { calls, ctx };
}

// ------------------------------------------------------------- measurement

const U = 20; // px per plan unit — deliberately not BASE_U (14), to exercise scaling.
const ORIGIN = { x: 231, y: 157 }; // arbitrary, non-zero, so a bug at (0,0) can't hide.

const BASE = {
  x: ORIGIN.x,
  y: ORIGIN.y,
  u: U,
  color: STATE_COLORS.working,
  identity: identityFor(4),
  appearance: appearanceFor('sess-fixture'),
  reduced: true,
};

/** Every point-bearing call, as `[x, y]` pairs. */
function points(calls) {
  return calls.filter((c) => typeof c.x === 'number' && typeof c.y === 'number');
}

function render(opts, pose) {
  const { calls, ctx } = makeFakeCtx();
  drawCharacter(ctx, pose || makePose(), { lod: 2, ...opts });
  return calls;
}

/** The recorded calls as a comparable string — the "byte-identical" in the tests below. */
function fingerprint(calls) {
  return JSON.stringify(
    calls.map((c) => [
      c.kind,
      c.x !== undefined ? Math.round(c.x * 1e6) / 1e6 : null,
      c.y !== undefined ? Math.round(c.y * 1e6) / 1e6 : null,
      c.r ?? c.rx ?? null,
      c.fill ?? null,
      c.stroke ?? null,
    ]),
  );
}

// ------------------------------------------------------------------ tests

test('BILLBOARD: the figure is byte-identical at every facing, and while walking', () => {
  // The whole of docs/DEVIATIONS.md §26, inverted. There is no rotation left in
  // the rig, so `bodyAngle` cannot displace anything — and this is the property
  // that says so, rather than a comment claiming it.
  const FACINGS = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2, 1.1, -2.7];
  for (const clipName of ['type', 'hand_raise', 'stand_wait', 'walk']) {
    const duration = CLIPS[clipName].duration;
    for (const frac of [0, 0.25, 0.5, 0.75, 0.999]) {
      let reference = null;
      for (const angle of FACINGS) {
        const pose = sampleClip(clipName, duration * frac, false);
        pose.bodyAngle = angle + pose.bodyAngle;
        const got = fingerprint(render(BASE, pose));
        if (reference === null) reference = got;
        else assert.equal(got, reference, `${clipName} @ ${frac} turned at bodyAngle=${angle}`);
      }
    }
  }
});

test('the contact ellipse is the only thing in the floor plane, and it is under the feet', () => {
  const calls = render(BASE);
  const ellipses = calls.filter((c) => c.kind === 'ellipse');
  assert.ok(ellipses.length > 0);
  // The contact shadow is the widest ellipse and is centred exactly on the
  // ground contact (WP-78: `SHADOW_OX`/`SHADOW_OY` are zero, and the feet point
  // IS `(x, y)`).
  const widest = ellipses.reduce((a, b) => (b.rx > a.rx ? b : a));
  assert.equal(widest.x, ORIGIN.x);
  assert.equal(widest.y, ORIGIN.y);
  // And the BODY stands on the contact point rather than straddling it. The
  // two ground marks — the shadow ellipse and the halo's pool — are the only
  // things that reach below it, and neither is part of the figure, so the
  // measurement is taken over the outlined parts (every one of which is built
  // from `moveTo`/`lineTo`/`quadraticCurveTo`).
  const outline = calls.filter(
    (c) => c.kind === 'moveTo' || c.kind === 'lineTo' || c.kind === 'quadraticCurveTo',
  );
  const bottom = Math.max(...outline.map((c) => c.y));
  const h = rigHeight(U);
  assert.ok(
    bottom <= ORIGIN.y + h * 0.02,
    `the figure hangs ${(bottom - ORIGIN.y).toFixed(1)}px below its own feet`,
  );
  // It fills its stated height, rather than a third of it: the old rig's
  // readable mass was 22 px where its box was 35 (the design study's own
  // measurement), and B's whole point is that the box and the mass are the same
  // shape.
  const top = Math.min(...outline.map((c) => c.y));
  assert.ok(
    ORIGIN.y - top >= BODY_HEIGHT_U * U * 0.75,
    `the figure fills only ${((ORIGIN.y - top) / (BODY_HEIGHT_U * U)).toFixed(2)} of its height`,
  );
});

test('POSES: every state is posed differently, and `walking` differs from all six', () => {
  const vectors = new Map();
  for (const state of [...RIG_STATES, 'walking']) {
    const k = rigPoseFor(state);
    vectors.set(
      state,
      JSON.stringify([k.lean, k.by, k.hy, k.hrot, k.aR, k.aL, k.sq, !!k.stand, !!k.recline]),
    );
  }
  const seen = new Map();
  for (const [state, v] of vectors) {
    assert.ok(!seen.has(v), `${state} is posed identically to ${seen.get(v)}`);
    seen.set(v, state);
  }
  assert.equal(vectors.size, 7);
  // And an unknown state still draws, as a powered-down robot.
  assert.equal(rigPoseFor('nonsense'), RIG_POSES.ended);
  assert.equal(rigPoseFor('let_go'), RIG_POSES.ended);
});

test('POSES: the six states draw differently, not just skeleton-differently', () => {
  const prints = new Map();
  for (const state of RIG_STATES) {
    const got = fingerprint(render({ ...BASE, color: STATE_COLORS[state], state }));
    for (const [other, prev] of prints) {
      assert.notEqual(got, prev, `${state} draws exactly like ${other}`);
    }
    prints.set(state, got);
  }
});

test('THE RAISED HAND clears the body top for needs_input, at every LOD and every scale', () => {
  // The single most important thing this rig draws (VISUAL-SPEC §5). It is not
  // enough that the pose puts it there: the hand must also survive the LOD
  // drop list, which is why this renders rather than reading the skeleton.
  const k = rigPoseFor('needs_input');
  const domeTopLocal = k.hy + 0.26 * 1.14; // the largest dome, at its top
  assert.ok(handTop(k) > domeTopLocal, 'the pose does not raise the hand past the dome');

  for (const lod of [0, 1, 2]) {
    for (const u of [8, 14, 20, 34]) {
      const calls = render({
        ...BASE,
        u,
        lod,
        color: STATE_COLORS.needs_input,
        state: 'needs_input',
      });
      const h = rigHeight(u);
      // The mitt is the only circle drawn at the raised hand's height. Find
      // every drawn point in the top fifth of the figure and check the hand is
      // among them — i.e. that something IS drawn up there at every LOD.
      const handY = ORIGIN.y - handTop(k) * h;
      const near = points(calls).filter((c) => Math.abs(c.y - handY) < h * 0.06);
      assert.ok(
        near.length > 0,
        `lod ${lod} @ u=${u}: nothing is drawn at the raised hand's height`,
      );
      // And it is genuinely above the dome, in screen space.
      const domeY = ORIGIN.y - domeTopLocal * h;
      assert.ok(handY < domeY, `lod ${lod} @ u=${u}: the hand is not above the dome`);
    }
  }
});

test('LOD: the drop list is exactly the design README’s — rim, chest glyph, far limbs', () => {
  // "at 100 agents the halo, chest glyph and far limbs should drop below
  // ~30 px" — docs/media/design/character/README.md, "Ranking and risks".
  // Nothing else is in the list, and the visor and the raised hand are in no
  // list at all.
  for (const u of [40, 20, 12]) {
    render({ ...BASE, u, lod: 2 });
    const detail = rigDetail();
    const expected = rigHeight(u) >= RIG_DETAIL_MIN_PX;
    assert.equal(detail.rim, expected, `u=${u}: rim`);
    assert.equal(detail.chestGlyph, expected, `u=${u}: chest glyph`);
    assert.equal(detail.farArm, expected, `u=${u}: far arm`);
  }
  // L0 drops the same three whatever the scale, because L0 is the overview and
  // the state colour plus the icon above the head are the whole message there.
  render({ ...BASE, u: 40, lod: 0 });
  const l0 = rigDetail();
  assert.deepEqual([l0.rim, l0.chestGlyph, l0.farArm], [false, false, false]);

  // The threshold is on the FIGURE's height, not on `u` — which is what the
  // README's "~30 px" means. 30 px of figure is 15 px per plan unit.
  assert.equal(RIG_UNIT_U * 15, RIG_DETAIL_MIN_PX);
});

test('LOD: the visor is drawn at every level of detail, and the figure never vanishes', () => {
  for (const lod of [0, 1, 2]) {
    for (const u of [8, 14, 20, 34]) {
      const calls = render({ ...BASE, u, lod, color: STATE_COLORS.working, state: 'working' });
      // The pane is the one fill in `RIG_PANE`. It is present at every level.
      const pane = calls.filter((c) => c.kind === 'fill' && c.fill === '#F7F1E1');
      assert.ok(pane.length > 0, `lod ${lod} @ u=${u}: no lit visor was drawn`);
    }
  }
});

test('MOTION: reduced motion contributes exactly zero phase, and freezes the figure', () => {
  // Not "a small phase" and not "the first frame": zero, so every term derived
  // from it drops out of the arithmetic (VISUAL-SPEC §10).
  for (const seconds of [0, 0.37, 1.9, 12345.678, NaN, undefined]) {
    assert.equal(idlePhase(seconds, true), 0, `reduced motion leaked a phase at t=${seconds}`);
  }
  // And without it, the phase really does move with the clock and stays in range.
  const samples = [0, 0.4, 1.1, 2.6, 3.3].map((s) => idlePhase(s, false));
  assert.ok(
    new Set(samples).size === samples.length,
    'the idle phase does not move with the clock',
  );
  for (const p of samples) assert.ok(p >= 0 && p < 1, `phase ${p} is out of range`);
  // A negative clock (a fixture's epoch behind the injected now) wraps rather
  // than going negative.
  assert.ok(idlePhase(-1.2, false) >= 0);

  // The whole figure is frozen: two different clocks draw the same picture.
  const a = fingerprint(render({ ...BASE, reduced: true, seconds: 0 }));
  const b = fingerprint(render({ ...BASE, reduced: true, seconds: 9999.5 }));
  assert.equal(a, b, 'reduced motion still moved with the clock');
});

test('MOTION: the walk is two frames and no blend', () => {
  const seen = new Set();
  for (let i = 0; i <= 40; i++) seen.add(walkFrame(i / 40));
  assert.deepEqual([...seen].sort(), [0, 1]);
  // And it is total over anything a clip could hand it.
  assert.equal(walkFrame(NaN), 0);
  assert.equal(walkFrame(-0.3), 1);
  assert.equal(walkFrame(7.25), 0);

  // Two frames, two different pictures.
  const one = fingerprint(
    render({ ...BASE, walking: true, reduced: false, seconds: 0.1 }, makePose({ seated: false })),
  );
  const two = fingerprint(
    render({ ...BASE, walking: true, reduced: false, seconds: 0.95 }, makePose({ seated: false })),
  );
  assert.notEqual(one, two, 'both walk frames draw the same picture');
});

test('DETERMINISM: the same session id draws byte-identically, twice and in any order', () => {
  // docs/DEVIATIONS.md §105: a face is a pure function of the session id.
  // Nothing is rolled, nothing is cached, nothing is persisted — so two renders
  // of the same id, with other ids rendered in between, are the same bytes.
  const ids = ['demo:actor-1', 'demo:actor-7', 'sess-zq04', 'sess-a7f2'];
  const first = new Map();
  for (const id of ids) {
    first.set(
      id,
      fingerprint(render({ ...BASE, appearance: appearanceFor(id), identity: identityFor(3) })),
    );
  }
  for (const id of [...ids].reverse()) {
    const again = fingerprint(
      render({ ...BASE, appearance: appearanceFor(id), identity: identityFor(3) }),
    );
    assert.equal(again, first.get(id), `${id} drew differently the second time`);
  }
  // And two different ids really do draw differently, so the check above is
  // not passing on a rig that ignores its identity.
  assert.notEqual(first.get(ids[0]), first.get(ids[1]));
});

test('HALO: every character still lays one, and never at L0', () => {
  // WP-85a §3.9, carried through WP-79 unchanged in intent: the state colour is
  // read against a constant that travels with the figure, not against the floor.
  for (const lod of [1, 2]) {
    const calls = render({ ...BASE, lod });
    const halo = calls.filter((c) => c.fill === '#F6F2E9' || c.stroke === '#F6F2E9');
    assert.ok(halo.length > 0, `lod ${lod} drew no halo at all`);
    // It is laid UNDER the body: the first halo mark precedes the first mark in
    // the state colour.
    const firstHalo = calls.findIndex((c) => c.fill === '#F6F2E9' || c.stroke === '#F6F2E9');
    const firstBody = calls.findIndex((c) => c.fill === STATE_COLORS.working);
    assert.ok(firstHalo >= 0 && firstBody > firstHalo, `lod ${lod} drew the halo over the body`);
  }
  const l0 = render({ ...BASE, lod: 0 });
  assert.equal(
    l0.filter((c) => c.fill === '#F6F2E9' || c.stroke === '#F6F2E9').length,
    0,
    'L0 drew a halo',
  );
});

test('the manager is the same figure, drawn by the same functions, with no state on it', () => {
  const { calls, ctx } = makeFakeCtx();
  assert.doesNotThrow(() => drawManagerFigure(ctx, { x: 50, y: 60, u: 14, angle: 1.3 }));
  assert.ok(calls.length > 0);
  // Billboarded like every agent: the angle it is handed changes nothing.
  const other = makeFakeCtx();
  drawManagerFigure(other.ctx, { x: 50, y: 60, u: 14, angle: -2.2 });
  assert.equal(fingerprint(other.calls), fingerprint(calls));
  // No angle at all still draws.
  const bare = makeFakeCtx();
  assert.doesNotThrow(() => drawManagerFigure(bare.ctx, { x: 0, y: 0, u: 14 }));
  // And no state colour anywhere on it.
  for (const c of calls) {
    for (const state of Object.values(STATE_COLORS)) {
      assert.notEqual(c.fill, state, 'the manager wore a state colour');
    }
  }
});

test('the state is recovered from the colour when a caller does not pass one', () => {
  // Every call site passes `state` now, and this is the guard for the ones that
  // do not: `colorForAgent` only ever returns a STATE_COLORS entry, so the
  // inverse is exact.
  for (const state of RIG_STATES) {
    const explicit = fingerprint(render({ ...BASE, color: STATE_COLORS[state], state }));
    const implied = fingerprint(render({ ...BASE, color: STATE_COLORS[state] }));
    assert.equal(implied, explicit, `${state} was not recovered from its colour`);
  }
});
