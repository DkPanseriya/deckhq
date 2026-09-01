import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawCharacter } from '../../public/render/rig.js';
import { sampleClip, CLIPS } from '../../public/render/clips.js';

/**
 * Proves the fix for "characters have hands on one side and head on other
 * side, looks like hands are on backside": rig.js used to rotate every body
 * part by raw `pose.bodyAngle`, which — given the rig's local frame faces
 * local -y, not local +x — put the head a quarter turn away from where
 * `bodyAngle` says the character actually faces. This file renders real
 * clips through the real `drawCharacter` with a fake canvas 2D context and
 * checks, purely from the recorded draw-call coordinates, that the head and
 * any actively-reaching hand land on the *facing* side of the body centre,
 * and legs/torso never do.
 *
 * `drawCharacter` computes screen coordinates by hand rather than issuing
 * `ctx.translate`/`ctx.rotate` per limb (see its performance-discipline doc
 * comment in rig.js), so every point it hands to `ctx.arc`/`ctx.moveTo`/etc.
 * already IS the final screen coordinate under the identity transform. The
 * fake context below still tracks a real `save`/`restore`/`translate`/
 * `rotate`/`scale` matrix and applies it to every recorded point, so this
 * test keeps working unchanged if the implementation ever moves to
 * `ctx.translate`/`ctx.rotate` instead — it does not assume "no transform
 * calls happen".
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
 * `a..f` CTM (updated by `translate`/`rotate`/`scale`, pushed/popped by
 * `save`/`restore`) and a flat log of every point-bearing call, recorded in
 * *world* (post-transform) coordinates. Style-only properties/methods
 * (`fillStyle`, `lineWidth`, `fill`, `stroke`, `beginPath`, ...) are no-ops.
 * @returns {{calls: Array<object>, ctx: object}}
 */
function makeFakeCtx() {
  const calls = [];
  let m = identity();
  const stack = [];
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
    beginPath() {},
    closePath() {},
    fill() {},
    stroke() {},
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
      calls.push({ kind: 'arc', r, ...applyPoint(m, x, y) });
    },
    ellipse(x, y, rx, ry) {
      calls.push({ kind: 'ellipse', rx, ry, ...applyPoint(m, x, y) });
    },
    fillText(text, x, y) {
      calls.push({ kind: 'fillText', ...applyPoint(m, x, y) });
    },
    strokeText(text, x, y) {
      calls.push({ kind: 'strokeText', ...applyPoint(m, x, y) });
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

// Radius bands (× u) that separate hands from heads among the recorded `arc`
// calls, from rig.js's own constants: HAND_R = 0.16, HEAD_R = 0.5 (hair
// re-draws the same head centre at 0.96 * HEAD_R). The floor ring (hand_raise
// only) and the selection ring are far larger (RING_BASE_R = 1.15,
// SELECTION_RING_R = 1.35) and fall outside both bands.
const HAND_R_BAND = [0.05 * U, 0.3 * U];
const HEAD_R_BAND = [0.3 * U, 0.75 * U];

/**
 * Renders `pose` through the real `drawCharacter` and pulls out the drawn
 * centres of its body parts, classified by the normative draw order
 * (VISUAL-SPEC §3: contact shadow -> legs -> torso -> held prop (behind) ->
 * arms -> head -> hair -> ...) and by radius. Requires `pose.prop == null`
 * (true for all four poses this file tests) so no extra arcs/segments from a
 * held prop confuse the classification.
 */
function renderAndMeasure(pose, lod = 1) {
  assert.equal(pose.prop, null, 'test helper assumes no held prop');
  const { calls, ctx } = makeFakeCtx();
  drawCharacter(ctx, pose, { x: ORIGIN.x, y: ORIGIN.y, u: U, lod, color: '#335544' });

  const arcs = calls.filter((c) => c.kind === 'arc');
  const handArcs = arcs.filter((c) => c.r >= HAND_R_BAND[0] && c.r <= HAND_R_BAND[1]);
  const headArcs = arcs.filter((c) => c.r >= HEAD_R_BAND[0] && c.r <= HEAD_R_BAND[1]);
  assert.equal(handArcs.length, 2, 'expected exactly 2 hand-scale arcs (right hand, left hand)');
  assert.ok(headArcs.length >= 1, 'expected at least 1 head-scale arc');

  // drawCharacter computes the right arm (side=1) before the left (side=-1)
  // — see computeArmGeometry/drawArmStroke call order — so among the
  // hand-scale arcs, index 0 is the right hand and index 1 is the left hand.
  const rightHand = handArcs[0];
  const leftHand = handArcs[1];
  // drawHead precedes drawHair, and both draw the same centre; either works.
  const head = headArcs[0];

  const ellipses = calls.filter((c) => c.kind === 'ellipse');
  // Contact shadow (ry = SHADOW_RY*u = 0.39u) vs torso (ry = TORSO_RY*u =
  // 0.61u): torso has the larger ry, regardless of draw order.
  const torso = ellipses.reduce((a, b) => (b.ry > a.ry ? b : a));

  // Legs are the first two moveTo+lineTo segments (hip -> foot, per leg),
  // drawn before arms and using no ctx.arc at all — see drawLegs. Requires
  // lod >= 1 (checked below) and lod < 2's finger-tick moveTo/lineTo calls
  // not yet having happened, which is true since finger ticks are drawn
  // after arms/hands, well after these first 4 points.
  assert.ok(lod >= 1, 'legs are only drawn at lod >= 1');
  const points = calls.filter((c) => c.kind === 'moveTo' || c.kind === 'lineTo');
  const legPoints = points.slice(0, 4);
  assert.equal(legPoints.length, 4, 'expected 4 leg points (2 per leg)');

  return { rightHand, leftHand, head, torso, legPoints };
}

/** Dot product of (point - ORIGIN) with the unit facing vector for `bodyAngle`. */
function forwardDot(point, bodyAngle) {
  const fx = Math.cos(bodyAngle);
  const fy = Math.sin(bodyAngle);
  return (point.x - ORIGIN.x) * fx + (point.y - ORIGIN.y) * fy;
}

// `bob` (a small vertical "breathing" offset, up to 0.5 plan units in these
// clips) shifts the torso/leg anchor slightly independent of facing, so
// "behind or at the centre" is checked with a small tolerance rather than
// an exact zero. It is an order of magnitude below the ~13px head offset or
// the 5-13px leg offsets this file otherwise measures, so it cannot mask a
// real forward/backward mistake.
const AT_CENTRE_EPSILON = 1.5 * (U / 14);

// docs/03-VISUAL-SPEC.md §3's convention, verbatim, matching plan.js's
// `angleTo`: 0 faces +x (east), PI/2 faces +y (south).
const FACINGS = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
const REQUIRED_CLIPS = ['type', 'hand_raise', 'stand_wait', 'walk'];
const T_FRACTIONS = [0, 0.25, 0.5, 0.75, 0.999];

/** Every (clip, t, bodyAngle) combination this file must hold for. */
function* cases() {
  for (const clipName of REQUIRED_CLIPS) {
    const duration = CLIPS[clipName].duration;
    for (const frac of T_FRACTIONS) {
      for (const bodyAngleAbs of FACINGS) {
        // Mirrors scene.js `_drawCharacterAt`: sampleClip's bodyAngle is only
        // a small relative sway (arcade's lean is the one exception); the
        // scene adds the seat/path's absolute facing on top before drawing.
        const pose = sampleClip(clipName, duration * frac, false);
        pose.bodyAngle = bodyAngleAbs + pose.bodyAngle;
        yield { clipName, frac, bodyAngleAbs, pose };
      }
    }
  }
}

// ------------------------------------------------------------------ tests

test('the facing convention itself matches plan.js: bodyAngle=0 is +x, bodyAngle=PI/2 is +y', () => {
  // A minimal, direct pin of VISUAL-SPEC §3 / plan.js's angleTo, independent
  // of any clip: a plain seated rest pose, facing due east, should draw its
  // head displaced in +x only (not +y), and facing due south should draw it
  // displaced in +y only (not x) — the exact quarter-turn this bug got wrong.
  const restPoseEast = sampleClip('stand_wait', 0, false);
  restPoseEast.bodyAngle = 0;
  const east = renderAndMeasure(restPoseEast);
  assert.ok(east.head.x - ORIGIN.x > 5, 'facing +x: head should be displaced toward +x');
  assert.ok(
    Math.abs(east.head.y - ORIGIN.y) < 1e-6,
    'facing +x: head should have ~zero y displacement',
  );

  const restPoseSouth = sampleClip('stand_wait', 0, false);
  restPoseSouth.bodyAngle = Math.PI / 2;
  const south = renderAndMeasure(restPoseSouth);
  assert.ok(south.head.y - ORIGIN.y > 5, 'facing +y: head should be displaced toward +y');
  assert.ok(
    Math.abs(south.head.x - ORIGIN.x) < 1e-6,
    'facing +y: head should have ~zero x displacement',
  );
});

test('the head is drawn forward of centre, on the facing side, for type/hand_raise/stand_wait/walk', () => {
  let checked = 0;
  for (const { clipName, frac, bodyAngleAbs, pose } of cases()) {
    const { head } = renderAndMeasure(pose);
    const dot = forwardDot(head, pose.bodyAngle);
    assert.ok(
      dot > 0,
      `${clipName} @ frac=${frac}, bodyAngle=${bodyAngleAbs}: head dot=${dot} should be > 0`,
    );
    checked++;
  }
  assert.equal(checked, REQUIRED_CLIPS.length * T_FRACTIONS.length * FACINGS.length);
});

test('a hand with hand:"key" (actively reaching, e.g. typing) is drawn on the same side as the head', () => {
  let keyHandsChecked = 0;
  for (const { clipName, frac, bodyAngleAbs, pose } of cases()) {
    const { rightHand, leftHand } = renderAndMeasure(pose);
    if (pose.armR.hand === 'key') {
      const dot = forwardDot(rightHand, pose.bodyAngle);
      assert.ok(
        dot > 0,
        `${clipName} @ frac=${frac}, bodyAngle=${bodyAngleAbs}: armR 'key' hand dot=${dot} should be > 0`,
      );
      keyHandsChecked++;
    }
    if (pose.armL.hand === 'key') {
      const dot = forwardDot(leftHand, pose.bodyAngle);
      assert.ok(
        dot > 0,
        `${clipName} @ frac=${frac}, bodyAngle=${bodyAngleAbs}: armL 'key' hand dot=${dot} should be > 0`,
      );
      keyHandsChecked++;
    }
  }
  // `type` is the only one of the 4 required clips that ever uses hand:'key'
  // (see clips.js TYPE_CLIP) — assert the check was actually exercised, so
  // this test cannot pass vacuously.
  assert.ok(keyHandsChecked > 0, 'expected at least one hand:"key" pose to have been checked');
});

test('legs and torso stay behind or at the centre, never on the forward/head side', () => {
  let checked = 0;
  for (const { clipName, frac, bodyAngleAbs, pose } of cases()) {
    const { torso, legPoints } = renderAndMeasure(pose);
    const torsoDot = forwardDot(torso, pose.bodyAngle);
    assert.ok(
      torsoDot <= AT_CENTRE_EPSILON,
      `${clipName} @ frac=${frac}, bodyAngle=${bodyAngleAbs}: torso dot=${torsoDot} should be <= ${AT_CENTRE_EPSILON}`,
    );
    for (const [i, p] of legPoints.entries()) {
      const legDot = forwardDot(p, pose.bodyAngle);
      assert.ok(
        legDot <= AT_CENTRE_EPSILON,
        `${clipName} @ frac=${frac}, bodyAngle=${bodyAngleAbs}: leg point ${i} dot=${legDot} should be <= ${AT_CENTRE_EPSILON}`,
      );
    }
    checked++;
  }
  assert.equal(checked, REQUIRED_CLIPS.length * T_FRACTIONS.length * FACINGS.length);
});

test('LOD 0 (simple body) still imports and draws without throwing, for every facing', () => {
  // Not geometrically checked (L0 has no separate head/arm offsets — see
  // drawSimpleBody), but a real regression here (e.g. a crash from the
  // facingRot change) would otherwise go unnoticed by the lod>=1 tests above.
  for (const bodyAngleAbs of FACINGS) {
    const pose = sampleClip('type', 0, false);
    pose.bodyAngle = bodyAngleAbs;
    const { ctx } = makeFakeCtx();
    assert.doesNotThrow(() => {
      drawCharacter(ctx, pose, { x: ORIGIN.x, y: ORIGIN.y, u: U, lod: 0, color: '#335544' });
    });
  }
});
