import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DOME_R,
  MITT_R,
  RIG_DETAIL_MIN_PX,
  RIG_SEATS,
  RIG_STATES,
  drawCharacter,
  labelBox,
  makePose,
  rigHeight,
  rigPoseFor,
  rigSeatedPose,
} from '../../public/render/rig.js';
import { STATE_COLORS, identityFor, appearanceFor } from '../../public/render/palette.js';
import { clipDuration, sampleClip } from '../../public/render/clips.js';
import { characterLife } from '../../public/render/life.js';
import { rigSeatOf } from '../../public/render/agents.js';

/**
 * WP-97 · B sits down.
 *
 * Until this package every figure on the floor stood — at a desk, on a sofa
 * and in a crew — because the rig had no seated pose (the WP-89 crew was the
 * one place that said so out loud). There are three now, built from each
 * state's standing pose rather than written out per state, and this file holds
 * the five things they have to keep true:
 *
 *   1. the three seats, and standing, are four different poses for every state;
 *   2. the FEET POINT never moves: shadow, label and the bottom of the figure
 *      are where they were, and only the body above them is lower;
 *   3. a raised hand's whole mitt clears the dome, seated, at every LOD;
 *   4. the same id draws the same bytes, seated as standing;
 *   5. the life clips — typing, the wave, the page flip, the slump — are still
 *      as many different pictures as they have frames, on every seat.
 */

const U = 20;
const ORIGIN = { x: 231, y: 157 };
const NOW = 1_760_000_000_000;

/** A context that records every call, and the styles in force at it. */
function recorder() {
  const calls = [];
  const ctx = {
    fillStyle: null,
    strokeStyle: null,
    lineWidth: 1,
    globalAlpha: 1,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    lineCap: 'butt',
    lineJoin: 'miter',
    save() {},
    restore() {},
    closePath() {},
    createRadialGradient: () => ({ addColorStop() {} }),
    measureText: (text) => ({ width: String(text).length * 6 }),
  };
  for (const name of [
    'beginPath',
    'moveTo',
    'lineTo',
    'quadraticCurveTo',
    'arc',
    'ellipse',
    'fill',
    'stroke',
    'fillRect',
    'fillText',
    'strokeText',
  ]) {
    ctx[name] = (...args) =>
      calls.push({ name, args, fill: ctx.fillStyle, stroke: ctx.strokeStyle, a: ctx.globalAlpha });
  }
  return { calls, ctx };
}

function render(opts, pose) {
  const { calls, ctx } = recorder();
  drawCharacter(ctx, pose || makePose(), {
    x: ORIGIN.x,
    y: ORIGIN.y,
    u: U,
    lod: 2,
    color: STATE_COLORS.working,
    state: 'working',
    identity: identityFor(4),
    appearance: appearanceFor('sess-fixture'),
    reduced: true,
    ...opts,
  });
  return calls;
}

const print = (calls) =>
  JSON.stringify(
    calls.map((c) => [
      c.name,
      c.args.map((v) => (typeof v === 'number' ? Math.round(v * 1e6) : v)),
      c.fill,
    ]),
  );

/** Every outlined point: the parts built from moveTo/lineTo/quadraticCurveTo. */
function outline(calls) {
  const out = [];
  for (const c of calls) {
    if (c.name === 'moveTo' || c.name === 'lineTo') out.push({ x: c.args[0], y: c.args[1] });
    if (c.name === 'quadraticCurveTo') out.push({ x: c.args[2], y: c.args[3] });
  }
  return out;
}

/** The tallest a dome can be drawn, above its centre, in local units. */
const DOME_HALF_MAX = Math.max(...DOME_R.map((r, i) => r * (i === 2 ? 1.14 : 0.98)));

// ------------------------------------------------------------------ poses

test('POSES: each seat is a different pose from the others and from standing, for every state', () => {
  const vector = (k) =>
    JSON.stringify([k.lean, k.by, k.hy, k.hrot, k.aR, k.aL, k.sq, !!k.stand, !!k.recline, k.seat]);
  for (const state of RIG_STATES) {
    const seen = new Map([[vector(rigPoseFor(state)), 'standing']]);
    for (const seat of RIG_SEATS) {
      for (const short of [false, true]) {
        const v = vector(rigSeatedPose(state, seat, short));
        const name = `${seat}${short ? ' (short)' : ''}`;
        assert.ok(!seen.has(v), `${state}: ${name} is posed exactly like ${seen.get(v)}`);
        seen.set(v, name);
      }
    }
  }
  // And each seat draws as a different picture, not only a different vector.
  const prints = new Map([['standing', print(render({}))]]);
  for (const seat of RIG_SEATS) {
    const got = print(render({ seat }));
    for (const [other, prev] of prints) assert.notEqual(got, prev, `${seat} draws like ${other}`);
    prints.set(seat, got);
  }
});

test('POSES: a seated body is lower than the standing one, and anything else stands', () => {
  for (const state of RIG_STATES) {
    const standing = rigPoseFor(state);
    for (const seat of RIG_SEATS) {
      const k = rigSeatedPose(state, seat, false);
      assert.ok(k.by < standing.by, `${state} on a ${seat}: the barrel did not come down`);
      assert.ok(k.hy < standing.hy, `${state} on a ${seat}: the dome did not come down`);
      assert.ok(Object.isFrozen(k), 'a seated pose is shared, so it must be frozen');
      // Looked up, not built: the rig allocates nothing per figure.
      assert.equal(rigSeatedPose(state, seat, false), k);
    }
  }
  assert.equal(rigSeatedPose('working', null), rigPoseFor('working'));
  assert.equal(rigSeatedPose('working', 'chair'), rigPoseFor('working'));
  assert.equal(rigSeatedPose('let_go', 'desk'), rigSeatedPose('ended', 'desk'));
  // Walking wins over any seat: a figure on its way somewhere is on its feet.
  const walking = makePose({ seated: false, legPhase: 0.3 });
  assert.equal(
    print(render({ walking: true, seat: 'desk' }, walking)),
    print(render({ walking: true }, walking)),
  );
});

// ------------------------------------------------------------- the feet

test('FEET POINT: shadow, label and the soles stay put whatever the seat', () => {
  for (const state of RIG_STATES) {
    for (const lod of [0, 1, 2]) {
      for (const u of [10, 20, 34]) {
        const h = rigHeight(u);
        const base = { state, color: STATE_COLORS[state], lod, u, label: 'Vera' };
        const standing = render(base);
        const top0 = Math.min(...outline(standing).map((p) => p.y));
        const text0 = standing.filter((c) => c.name === 'fillText').map((c) => c.args);
        for (const seat of RIG_SEATS) {
          const calls = render({ ...base, seat });
          const where = `${state} on a ${seat}, lod ${lod}, u ${u}`;
          // The contact shadow — the widest ellipse — is centred on the feet.
          const ellipses = calls.filter((c) => c.name === 'ellipse');
          const widest = ellipses.reduce((a, b) => (b.args[2] > a.args[2] ? b : a));
          assert.equal(widest.args[0], ORIGIN.x, `${where}: the shadow moved in x`);
          assert.equal(widest.args[1], ORIGIN.y, `${where}: the shadow moved in y`);
          // Nothing hangs below the feet…
          const pts = outline(calls);
          const bottom = Math.max(...pts.map((p) => p.y));
          assert.ok(
            bottom <= ORIGIN.y + h * 0.02,
            `${where}: ${bottom - ORIGIN.y}px below the feet`,
          );
          // …the body is lower than it was standing…
          const top = Math.min(...pts.map((p) => p.y));
          assert.ok(top >= top0 - 0.5, `${where}: the seated figure is taller than the standing`);
          // …and the name is exactly where it was.
          const text = calls.filter((c) => c.name === 'fillText').map((c) => c.args);
          assert.deepEqual(text, text0, `${where}: the label moved`);
        }
      }
    }
  }
  // And "where it was" is under the feet: the collision pass measures a label
  // with `labelBox` off the feet point, and the seated figure paints it there.
  const { ctx } = recorder();
  const box = labelBox(ctx, ORIGIN.x, ORIGIN.y, U, 'Vera');
  for (const seat of RIG_SEATS) {
    const painted = render({ seat, label: 'Vera' }).find((c) => c.name === 'fillText');
    assert.deepEqual(painted.args, ['Vera', ORIGIN.x, box.top], `${seat}: label off the feet`);
  }
});

// ------------------------------------------------------- the raised hand

test('THE RAISED HAND: seated, the whole mitt clears the dome, at every LOD and scale', () => {
  for (const seat of RIG_SEATS) {
    for (const lod of [0, 1, 2]) {
      for (const u of [8, 14, 20, 34]) {
        const h = rigHeight(u);
        const short = lod === 0 || h < RIG_DETAIL_MIN_PX;
        const k = rigSeatedPose('needs_input', seat, short);
        const where = `${seat}, lod ${lod}, u ${u}`;
        // The hand is exactly where the standing pose holds it: unchanged.
        assert.deepEqual(k.aR, rigPoseFor('needs_input').aR, `${where}: the hand moved`);
        const calls = render({
          seat,
          lod,
          u,
          state: 'needs_input',
          color: STATE_COLORS.needs_input,
        });
        const r = MITT_R * h;
        const mitt = calls.find(
          (c) =>
            c.name === 'arc' && Math.abs(c.args[2] - r) < 1e-9 && c.args[1] < ORIGIN.y - 0.9 * h,
        );
        assert.ok(mitt, `${where}: no raised mitt was drawn`);
        // Its bounding box — the bottom of it, not only the top — is above the
        // top of the largest dome the identity hash can deal.
        const domeTopY = ORIGIN.y - (k.hy + DOME_HALF_MAX) * h;
        assert.ok(
          mitt.args[1] + r < domeTopY,
          `${where}: the mitt's bottom (${(mitt.args[1] + r).toFixed(2)}) is not above the dome (${domeTopY.toFixed(2)})`,
        );
        // And the visor, the other thing no LOD drops, is still lit.
        assert.ok(
          calls.some((c) => c.name === 'fill' && c.fill === '#F7F1E1'),
          `${where}: no lit visor`,
        );
      }
    }
  }
});

test('LOD: below 30 px the seated body is a shorter silhouette, and never above 30', () => {
  for (const seat of RIG_SEATS) {
    const tall = rigSeatedPose('working', seat, false);
    const short = rigSeatedPose('working', seat, true);
    assert.ok(short.hy < tall.hy, `${seat}: the short silhouette is not shorter`);
    // Drawn: at 12 px per unit (24 px of figure) the lap is one mass, so the
    // short figure issues fewer calls than the full one at the same scale.
    const small = render({ seat, u: 12, lod: 2 });
    const big = render({ seat, u: 20, lod: 2 });
    assert.ok(small.length < big.length, `${seat}: the small figure costs as much as the big one`);
  }
});

// ------------------------------------------------------------ determinism

test('DETERMINISM: the same id draws byte-identically seated, and two ids differ', () => {
  const ids = ['demo:actor-1', 'demo:actor-7', 'sess-zq04'];
  for (const seat of RIG_SEATS) {
    const first = new Map();
    for (const id of ids) first.set(id, print(render({ seat, appearance: appearanceFor(id) })));
    for (const id of [...ids].reverse()) {
      assert.equal(
        print(render({ seat, appearance: appearanceFor(id) })),
        first.get(id),
        `${id} on a ${seat}`,
      );
    }
    assert.notEqual(first.get(ids[0]), first.get(ids[1]), `${seat}: identity is ignored`);
  }
});

// ---------------------------------------------------------- the life clips

/**
 * One frame of a clip, drawn the way `scene-draw.js` draws it: the clip
 * sampled at a pinned phase and the life director asked at the same pin.
 */
function frame(seat, state, clip, phase, laptop) {
  const a = {
    id: `a-${state}`,
    projectId: 'p0',
    projectMk: 'MK1',
    activityState: state,
    ackState: 'active',
    reviewSince: state === 'for_review' ? NOW - 90_000 : null,
    needsInputSince: state === 'needs_input' ? NOW - 30_000 : null,
    lastActivityAt: NOW - 30_000,
  };
  const pose = sampleClip(clip, phase * clipDuration(clip), false);
  return print(
    render(
      {
        seat,
        state,
        color: STATE_COLORS[state],
        reduced: false,
        seconds: NOW / 1000,
        phase,
        laptop,
        life: characterLife(a, { nowMs: NOW, state, lod: 2, reduced: false, pinned: phase }),
      },
      pose,
    ),
  );
}

test('LIFE: typing, the wave, the page flip and the slump are still that many pictures seated', () => {
  // [state, clip, frame count, frames whose inputs differ]. The page flip is
  // four frames of three values — flat, half, edge-on, half — so it is three
  // pictures and the fourth is the second again, by §2's own table.
  const STRIPS = [
    ['working', 'type', 4, [0, 1, 2, 3]],
    ['needs_input', 'hand_raise', 4, [0, 1, 2, 3]],
    ['for_review', 'stand_wait', 4, [0, 1, 2]],
    ['stalled', 'slump', 3, [0, 1, 2]],
  ];
  for (const seat of RIG_SEATS) {
    for (const [state, clip, frames, distinct] of STRIPS) {
      const pictures = distinct.map((i) => frame(seat, state, clip, i / frames));
      for (let i = 0; i < pictures.length; i++) {
        for (let j = i + 1; j < pictures.length; j++) {
          assert.notEqual(
            pictures[i],
            pictures[j],
            `${clip} on a ${seat}: frames ${distinct[i]} and ${distinct[j]} are one picture`,
          );
        }
      }
    }
  }
});

test('LIFE: the laptop on a crew member’s knees folds with its cable', () => {
  const open = frame('floor', 'working', 'type', 0, 1);
  const half = frame('floor', 'working', 'type', 0, 0.5);
  const shut = frame('floor', 'working', 'type', 0, 0);
  assert.notEqual(open, half);
  assert.notEqual(half, shut);
  // Omitted, it is open — the laptop is part of sitting on the floor.
  assert.equal(frame('floor', 'working', 'type', 0, undefined), open);
  // And only the floor has one.
  assert.equal(frame('desk', 'working', 'type', 0, 1), frame('desk', 'working', 'type', 0, 0));
});

// ------------------------------------------------------------ who sits where

test('SEATING: the floor tells the rig where each figure sits', () => {
  const rec = (over) => ({ path: [], targetSeat: {}, placement: 'desk', seated: true, ...over });
  const sitting = makePose({ seated: true });
  const standing = makePose({ seated: false });
  assert.equal(rigSeatOf(rec({})), 'desk');
  assert.equal(rigSeatOf(rec({ placement: 'office' })), 'sofa');
  assert.equal(rigSeatOf(rec({ targetSeat: { crew: true, junior: true } })), 'floor');
  // Lounge: the clip says whether its activity sits.
  assert.equal(rigSeatOf(rec({ placement: 'lounge', seated: false }), sitting), 'sofa');
  assert.equal(rigSeatOf(rec({ placement: 'lounge', seated: false }), standing), null);
  // Bare carpet: a queue place, an overflow ring, a junior beside its parent.
  assert.equal(
    rigSeatOf(rec({ placement: 'office', seated: false, targetSeat: { standing: true } })),
    null,
  );
  assert.equal(rigSeatOf(rec({ targetSeat: { overflow: true } })), null);
  assert.equal(rigSeatOf(rec({ targetSeat: { junior: true } })), null);
  // Walking, nobody sits; and a record that is not there sits nowhere.
  assert.equal(rigSeatOf(rec({ path: [{ x: 1, y: 2 }] })), null);
  assert.equal(rigSeatOf(null), null);
  assert.equal(rigSeatOf(rec({ placement: 'let_go', seated: false })), null);
});
