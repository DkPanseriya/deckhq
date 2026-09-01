import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLIPS,
  LOUNGE_CLIPS,
  IDLE_VARIATIONS,
  sampleClip,
  clipForState,
  makeActivityRotation,
} from '../../public/render/clips.js';

// docs/03-VISUAL-SPEC.md §4.1 + §4.2 — the 16-clip work list, verbatim durations.
const EXPECTED = {
  type: { duration: 0.9, loop: true },
  think: { duration: 3.2, loop: true },
  drink: { duration: 2.6, loop: false },
  stretch: { duration: 2.0, loop: false },
  hand_raise: { duration: 1.4, loop: true },
  slump: { duration: 4.0, loop: true },
  walk: { duration: 0.8, loop: true },
  stand_wait: { duration: 4.0, loop: true },
  pool: { duration: 4.5, loop: true },
  table_tennis: { duration: 1.6, loop: true },
  board_game: { duration: 5.0, loop: true },
  arcade: { duration: 2.2, loop: true },
  coffee: { duration: 6.0, loop: false },
  eat: { duration: 3.4, loop: true },
  chat: { duration: 4.0, loop: true },
  lounge_idle: { duration: 5.0, loop: true },
};

const HAND_STATES = new Set(['rest', 'key', 'grip', 'open', 'raised']);
const PROP_VALUES = new Set([null, 'mug', 'cue', 'paddle', 'controller', 'piece', 'plate']);

function assertArm(arm, path) {
  assert.equal(typeof arm.shoulder, 'number', `${path}.shoulder is a number`);
  assert.ok(Number.isFinite(arm.shoulder), `${path}.shoulder is finite`);
  assert.equal(typeof arm.elbow, 'number', `${path}.elbow is a number`);
  assert.ok(Number.isFinite(arm.elbow), `${path}.elbow is finite`);
  assert.ok(HAND_STATES.has(arm.hand), `${path}.hand "${arm.hand}" is a valid hand state`);
}

/** Asserts `pose` is a complete, well-typed Pose (VISUAL-SPEC §3 + rig.js extensions). */
function assertCompletePose(pose, label) {
  assert.equal(typeof pose.bodyAngle, 'number', `${label}: bodyAngle is a number`);
  assert.ok(Number.isFinite(pose.bodyAngle), `${label}: bodyAngle is finite`);
  assert.equal(typeof pose.lean, 'number', `${label}: lean is a number`);
  assert.equal(typeof pose.headTurn, 'number', `${label}: headTurn is a number`);
  assertArm(pose.armL, `${label}: armL`);
  assertArm(pose.armR, `${label}: armR`);
  assert.equal(typeof pose.legPhase, 'number', `${label}: legPhase is a number`);
  assert.equal(typeof pose.seated, 'boolean', `${label}: seated is a boolean`);
  assert.ok(PROP_VALUES.has(pose.prop), `${label}: prop "${pose.prop}" is a valid prop value`);
  assert.equal(typeof pose.bob, 'number', `${label}: bob is a number`);
  assert.equal(typeof pose.ring, 'boolean', `${label}: ring is a boolean`);
  assert.equal(typeof pose.ringPhase, 'number', `${label}: ringPhase is a number`);
  assert.equal(typeof pose.fingerPhase, 'number', `${label}: fingerPhase is a number`);
  assert.equal(typeof pose.thoughtPhase, 'number', `${label}: thoughtPhase is a number`);
  assert.equal(typeof pose.speechPhase, 'number', `${label}: speechPhase is a number`);
}

test('all 16 clips from VISUAL-SPEC §4 exist with the spec durations and loop flags', () => {
  const names = Object.keys(EXPECTED);
  assert.equal(names.length, 16);
  for (const name of names) {
    assert.ok(CLIPS[name], `CLIPS.${name} exists`);
    assert.equal(CLIPS[name].duration, EXPECTED[name].duration, `${name}.duration`);
    assert.equal(CLIPS[name].loop, EXPECTED[name].loop, `${name}.loop`);
  }
  // No extras and no misses vs. the module's own clip table.
  assert.deepEqual(Object.keys(CLIPS).sort(), names.sort());
});

test('LOUNGE_CLIPS is exactly the eight §4.2 clips', () => {
  assert.deepEqual(
    [...LOUNGE_CLIPS].sort(),
    ['pool', 'table_tennis', 'board_game', 'arcade', 'coffee', 'eat', 'chat', 'lounge_idle'].sort(),
  );
});

test('IDLE_VARIATIONS is drink/think/stretch', () => {
  assert.deepEqual(IDLE_VARIATIONS, ['drink', 'think', 'stretch']);
});

test('sampleClip returns a complete, well-typed Pose at t=0, mid, end and past-end for every clip', () => {
  for (const name of Object.keys(CLIPS)) {
    const duration = CLIPS[name].duration;
    for (const t of [0, duration / 2, duration, duration * 1.75]) {
      const pose = sampleClip(name, t, false);
      assertCompletePose(pose, `${name} @ t=${t}`);
    }
  }
});

test('reduced motion returns a single, time-invariant pose per clip', () => {
  for (const name of Object.keys(CLIPS)) {
    const duration = CLIPS[name].duration;
    const samples = [0, duration * 0.25, duration * 0.5, duration * 1.5, duration * 3].map((t) =>
      sampleClip(name, t, true),
    );
    assertCompletePose(samples[0], `${name} reduced`);
    for (let i = 1; i < samples.length; i++) {
      assert.deepEqual(samples[i], samples[0], `${name}: reduced pose must not vary with t`);
    }
  }
});

test('looping clips wrap: sampling past duration matches sampling the wrapped remainder', () => {
  for (const name of Object.keys(CLIPS)) {
    const clip = CLIPS[name];
    if (!clip.loop) continue;
    const t = clip.duration * 2.3;
    const wrapped = t % clip.duration;
    const a = sampleClip(name, t, false);
    const b = sampleClip(name, wrapped, false);
    assert.deepEqual(a, b, `${name}: t=${t} should equal wrapped t=${wrapped}`);
  }
});

test('looping clips are continuous across the wrap boundary', () => {
  for (const name of Object.keys(CLIPS)) {
    const clip = CLIPS[name];
    if (!clip.loop) continue;
    const justBefore = sampleClip(name, clip.duration - 0.001, false);
    const atZero = sampleClip(name, 0, false);
    // Numeric fields should be nearly identical across the seam (clips are
    // authored with matching t=0 / t=1 keyframes for a seamless loop).
    assert.ok(
      Math.abs(justBefore.lean - atZero.lean) < 0.05,
      `${name}: lean should be continuous across the loop seam`,
    );
  }
});

test('non-looping clips hold their final keyframe past duration', () => {
  for (const name of Object.keys(CLIPS)) {
    const clip = CLIPS[name];
    if (clip.loop) continue;
    const atEnd = sampleClip(name, clip.duration, false);
    const wayPast = sampleClip(name, clip.duration * 5, false);
    assert.deepEqual(wayPast, atEnd, `${name}: holds its final pose once t >= duration`);
  }
});

test('stepped fields (hand, prop, seated) never blend to an invalid value', () => {
  for (const name of Object.keys(CLIPS)) {
    const clip = CLIPS[name];
    const steps = 40;
    for (let i = 0; i <= steps; i++) {
      const t = (clip.duration * i) / steps;
      const pose = sampleClip(name, t, false);
      assert.ok(HAND_STATES.has(pose.armL.hand), `${name} @ t=${t}: armL.hand valid`);
      assert.ok(HAND_STATES.has(pose.armR.hand), `${name} @ t=${t}: armR.hand valid`);
      assert.ok(PROP_VALUES.has(pose.prop), `${name} @ t=${t}: prop valid`);
      assert.equal(typeof pose.seated, 'boolean', `${name} @ t=${t}: seated is boolean`);
    }
  }
});

test('paired clips (table_tennis, chat) expose paired=true and partnerPhaseOffset=0.5', () => {
  for (const name of ['table_tennis', 'chat']) {
    assert.equal(CLIPS[name].paired, true, `${name}.paired`);
    assert.equal(CLIPS[name].partnerPhaseOffset, 0.5, `${name}.partnerPhaseOffset`);
  }
  // Non-paired clips should not claim to be paired.
  for (const name of Object.keys(CLIPS)) {
    if (name === 'table_tennis' || name === 'chat') continue;
    assert.ok(!CLIPS[name].paired, `${name} is not paired`);
  }
});

test('hand_raise exposes a ring marker and a phase the rig can animate', () => {
  assert.equal(CLIPS.hand_raise.ring, true);
  const early = sampleClip('hand_raise', 0, false);
  const late = sampleClip('hand_raise', CLIPS.hand_raise.duration * 0.75, false);
  assert.equal(early.ring, true);
  assert.equal(late.ring, true);
  assert.notEqual(early.ringPhase, late.ringPhase, 'ringPhase should vary over the clip');
});

test('type exposes fingerPhase for L2 finger taps', () => {
  const duringKey = sampleClip('type', 0, false); // t=0 is an armR "key" keyframe
  // Keyframe t is normalised 0..1; sampleClip's t is seconds, so the exact
  // "rest" keyframe (normalised t=0.125) lands at 0.125 * duration seconds.
  const duringRest = sampleClip('type', CLIPS.type.duration * 0.125, false);
  assert.equal(typeof duringKey.fingerPhase, 'number');
  assert.equal(duringKey.fingerPhase, 1, 'the t=0 keyframe is a "key" stroke, fingerPhase 1');
  assert.equal(duringRest.fingerPhase, 0, 'the rest keyframe should be exactly fingerPhase 0');
  assert.notEqual(duringKey.fingerPhase, duringRest.fingerPhase);
});

test('clipForState matches VISUAL-SPEC §5', () => {
  assert.equal(clipForState('working'), 'type');
  assert.equal(clipForState('needs_input'), 'hand_raise');
  assert.equal(clipForState('stalled'), 'slump');
  assert.equal(clipForState('for_review'), 'stand_wait');
  assert.equal(clipForState('moving'), 'walk');
  assert.equal(typeof clipForState('benched'), 'string');
  assert.ok(LOUNGE_CLIPS.includes(clipForState('benched')));
  assert.equal(clipForState('let_go'), null);
});

test('makeActivityRotation holds each activity 45-90s', () => {
  const rotation = makeActivityRotation(Math.random);
  for (let i = 0; i < 200; i++) {
    const { activity, holdMs } = rotation.pick();
    assert.ok(LOUNGE_CLIPS.includes(activity), 'picks a real lounge clip');
    assert.ok(holdMs >= 45000 && holdMs <= 90000, `holdMs ${holdMs} in [45000,90000]`);
  }
});

test('makeActivityRotation degrades a paired/group activity to solo when no partner is free', () => {
  // Force the picker to always choose 'chat' first (a requiresPartner clip)
  // by stubbing rng to return 0 (picks index 0 of LOUNGE_CLIPS), then deny
  // every partner. Since LOUNGE_CLIPS[0] is 'pool' (solo-capable), test both
  // ends of the pool explicitly via a rng that walks every index.
  const n = LOUNGE_CLIPS.length;
  let calls = 0;
  const rng = () => {
    // First call picks the activity index, second call (if degraded) picks
    // the solo replacement, third call picks holdMs — cycle deterministically.
    const v = (calls % n) / n;
    calls++;
    return v;
  };
  const rotation = makeActivityRotation(rng);
  let sawDegradation = false;
  let sawPairedChoice = false;
  for (let i = 0; i < n * 3; i++) {
    const { activity, degraded } = rotation.pick({ partnerFree: () => false });
    if (CLIPS[activity].requiresPartner)
      sawPairedChoice = degraded === false ? sawPairedChoice : true;
    if (degraded) {
      sawDegradation = true;
      assert.ok(!CLIPS[activity].requiresPartner, 'degraded activity must be solo-capable');
    }
  }
  assert.ok(
    sawDegradation,
    'at least one paired pick should degrade when partnerFree is always false',
  );

  // And when a partner IS free, a paired activity is never degraded.
  let sawPairedUndegraded = false;
  calls = 0;
  const rotation2 = makeActivityRotation(rng);
  for (let i = 0; i < n * 3; i++) {
    const { activity, degraded } = rotation2.pick({ partnerFree: () => true });
    if (CLIPS[activity].requiresPartner) {
      assert.equal(degraded, false, 'a free partner means no degradation');
      sawPairedUndegraded = true;
    }
  }
  assert.ok(
    sawPairedUndegraded,
    'test should have exercised at least one paired activity with a free partner',
  );
});

test('every clip with requiresPartner is one of the spec-labelled "Paired"/"Paired or group" clips', () => {
  const expectedPartnerClips = new Set(['table_tennis', 'board_game', 'chat']);
  for (const name of Object.keys(CLIPS)) {
    if (CLIPS[name].requiresPartner) {
      assert.ok(expectedPartnerClips.has(name), `${name} unexpectedly requires a partner`);
    }
  }
  for (const name of expectedPartnerClips) {
    assert.ok(CLIPS[name].requiresPartner, `${name} should require a partner`);
  }
});

// ------------------------------------------------- the four asked-for motions
//
// The rig places a hand at `-0.4 + cos(shoulder)*0.55 + cos(shoulder+elbow)*0.5`
// along the local FORWARD axis, where negative is forward, and at
// `sin(shoulder)` out to the side. These helpers read a sampled pose the same
// way the rig does, so the assertions below are about what actually gets
// drawn rather than about the numbers in the clip data.

/** How far forward a hand reaches. Negative is in front of the body. */
function forwardReach(a) {
  return -0.4 + Math.cos(a.shoulder) * 0.55 + Math.cos(a.shoulder + a.elbow) * 0.5;
}

/** How far out to the side a hand sits. */
function lateralReach(a) {
  return Math.sin(a.shoulder);
}

test('type: both hands are on the keys, in front of the body, all cycle', () => {
  const d = CLIPS.type.duration;
  for (const f of [0, 0.125, 0.25, 0.4, 0.5, 0.625, 0.75, 0.9]) {
    const pose = sampleClip('type', d * f, false);
    assert.equal(pose.armR.hand, 'key', `right hand off the keys at ${f}`);
    assert.equal(pose.armL.hand, 'key', `left hand off the keys at ${f}`);
    assert.ok(
      forwardReach(pose.armR) < -0.5,
      `right hand only ${forwardReach(pose.armR).toFixed(2)} forward at ${f} — reads as folded, not typing`,
    );
    assert.ok(forwardReach(pose.armL) < -0.5, `left hand not forward at ${f}`);
  }
});

test('type: fingerPhase varies so the L2 finger taps animate', () => {
  const d = CLIPS.type.duration;
  const seen = new Set();
  for (let i = 0; i < 16; i++) seen.add(sampleClip('type', (d * i) / 16, false).fingerPhase);
  assert.ok(seen.size > 2, 'fingerPhase must move, not sit at one value');
});

test('walk: the arms swing sideways, in antiphase with each other', () => {
  const d = CLIPS.walk.duration;
  let sawRightWider = false;
  let sawLeftWider = false;
  for (let i = 0; i < 12; i++) {
    const pose = sampleClip('walk', (d * i) / 12, false);
    const diff = lateralReach(pose.armR) - lateralReach(pose.armL);
    if (diff > 0.05) sawRightWider = true;
    if (diff < -0.05) sawLeftWider = true;
  }
  assert.ok(sawRightWider && sawLeftWider, 'each arm must take its turn swinging out');
});

test('drink: exactly one hand takes the mug, and holds it for a contiguous span', () => {
  const d = CLIPS.drink.duration;
  let withMug = 0;
  let firstMug = null;
  let lastMug = null;
  for (let i = 0; i <= 20; i++) {
    const t = (d * i) / 20;
    const pose = sampleClip('drink', t, false);
    const grips = [pose.armR.hand, pose.armL.hand].filter((h) => h === 'grip').length;
    if (pose.prop === 'mug') {
      withMug++;
      if (firstMug === null) firstMug = i;
      lastMug = i;
      assert.equal(grips, 1, `exactly one hand should grip the mug at ${t.toFixed(2)}s`);
    }
  }
  assert.ok(withMug > 0, 'the mug must actually be held');
  // Contiguous: every sample between the first and last is also holding it.
  for (let i = firstMug; i <= lastMug; i++) {
    assert.equal(sampleClip('drink', (d * i) / 20, false).prop, 'mug', 'the mug must not flicker');
  }
});

test('drink: the mug comes up to the head and back down', () => {
  const d = CLIPS.drink.duration;
  const atStart = forwardReach(sampleClip('drink', 0, false).armR);
  const atMouth = forwardReach(sampleClip('drink', d * 0.42, false).armR);
  const atEnd = forwardReach(sampleClip('drink', d * 0.99, false).armR);
  assert.ok(atMouth < atStart, 'the mug hand must travel toward the head');
  assert.ok(atEnd > atMouth, 'and come back down again');
});

test('think: the thought artifact is visible for most of the loop', () => {
  // The rig fades the dots with sin(thoughtPhase * PI), so this measures what
  // is actually drawn, not the raw field.
  const d = CLIPS.think.duration;
  let visible = 0;
  const samples = 24;
  for (let i = 0; i < samples; i++) {
    const p = sampleClip('think', (d * i) / samples, false).thoughtPhase;
    const opacity = Math.sin(Math.min(1, Math.max(0, p)) * Math.PI);
    if (opacity > 0.5) visible++;
  }
  assert.ok(
    visible / samples > 0.7,
    `the thought artifact is legible only ${((visible / samples) * 100).toFixed(0)}% of the loop`,
  );
});

test('think: the thinking hand is raised toward the chin, not resting', () => {
  const pose = sampleClip('think', CLIPS.think.duration * 0.3, false);
  assert.ok(forwardReach(pose.armR) < -0.8, 'the hand should be well forward, at the chin');
});
