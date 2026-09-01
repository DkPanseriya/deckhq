/**
 * The contract between the model's states and what appears on the floor.
 *
 * docs/03-VISUAL-SPEC.md §5 is the table this guards. It is worth its own
 * suite because a state that falls through to a default here does not throw —
 * it silently shows the user the wrong thing, which is the one failure mode
 * this product cannot afford.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATE_COLORS } from '../../public/render/palette.js';
import { CLIPS, clipForState } from '../../public/render/clips.js';
import { ACTIVITY_STATES, ACK_STATES } from '../../src/core/model.mjs';

test('every ActivityState and AckState has its own colour', () => {
  for (const state of [...ACTIVITY_STATES, ...ACK_STATES]) {
    if (state === 'active') continue; // `active` is rendered by its activityState
    assert.ok(
      STATE_COLORS[state],
      `${state} has no colour, so it would inherit another state's meaning`,
    );
  }
});

test('the spec colours are exact', () => {
  // docs/03-VISUAL-SPEC.md §5, verbatim.
  assert.equal(STATE_COLORS.working, '#2E7D63');
  assert.equal(STATE_COLORS.needs_input, '#B87333');
  assert.equal(STATE_COLORS.stalled, '#9A7B4F');
  assert.equal(STATE_COLORS.for_review, '#C0392B');
  assert.equal(STATE_COLORS.benched, '#7B8794');
  assert.equal(STATE_COLORS.let_go, '#BDB7AA');
});

test('COLOUR DISCIPLINE: crimson belongs to for_review alone', () => {
  const crimson = STATE_COLORS.for_review.toLowerCase();
  for (const [state, colour] of Object.entries(STATE_COLORS)) {
    if (state === 'for_review') continue;
    assert.notEqual(
      colour.toLowerCase(),
      crimson,
      `${state} reuses the reserved accent; red on the floor must mean "in your office"`,
    );
  }
});

test('every state colour is distinguishable from every other', () => {
  // Colour-blind users rely on the icon, but a duplicate colour would also
  // make two states indistinguishable for everyone at L0.
  const seen = new Map();
  for (const [state, colour] of Object.entries(STATE_COLORS)) {
    const key = colour.toLowerCase();
    assert.ok(!seen.has(key), `${state} and ${seen.get(key)} share ${colour}`);
    seen.set(key, state);
  }
});

test('an ended session must not appear to be typing', () => {
  // `ended` sits at its project desk (only an explicit bench moves it), so it
  // is on screen and needs a still pose. Playing `type` would tell the user a
  // dead session is producing output.
  const clip = clipForState('ended');
  assert.ok(clip, 'ended has no clip');
  assert.notEqual(clip, 'type');
  assert.ok(CLIPS[clip], `ended maps to "${clip}", which is not a real clip`);
  assert.notEqual(
    STATE_COLORS.ended,
    STATE_COLORS.working,
    'ended must not wear the working colour',
  );
});

test('clipForState covers every activity state with a real clip', () => {
  for (const state of ACTIVITY_STATES) {
    const clip = clipForState(state);
    assert.ok(clip, `${state} has no clip`);
    assert.ok(CLIPS[clip], `${state} maps to "${clip}", which is not a real clip`);
  }
  assert.ok(CLIPS[clipForState('benched')]);
  assert.equal(clipForState('let_go'), null, 'a let-go agent is off the floor and draws nothing');
});

test('the attention states map to their spec clips', () => {
  assert.equal(clipForState('working'), 'type');
  assert.equal(clipForState('needs_input'), 'hand_raise');
  assert.equal(clipForState('stalled'), 'slump');
  assert.equal(clipForState('for_review'), 'stand_wait');
});
