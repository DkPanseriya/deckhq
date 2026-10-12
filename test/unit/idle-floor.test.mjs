/**
 * AN IDLE SESSION ON THE FLOOR (13 October 2026).
 *
 * The daemon says which sessions are open and doing nothing (`idle`,
 * `state-machine.test.mjs` holds the rule). This holds what the floor and the
 * panel do with that: the robot is drawn resting, in the bench's own grey, at
 * its own desk; it does not type; and wherever its state is named, the word is
 * Idle. No seventh colour was added to do it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATE_COLORS } from '../../public/render/palette.js';
import { colorForAgent, iconForAgent, stateForAgent } from '../../public/render/scene-agent.js';
import { clipForActivity, initialClipFor } from '../../public/render/agents-activity.js';
import { IDLE_LABEL, isSendKey, visualState } from '../../public/panel-rules.js';
import { counts, projects } from '../../src/core/model.mjs';

const working = { ackState: 'active', activityState: 'working' };
const idle = { ...working, idle: true };

test('an idle session is drawn resting, in a colour the floor already had', () => {
  assert.equal(stateForAgent(working), 'working');
  assert.equal(stateForAgent(idle), 'benched');
  assert.equal(colorForAgent(idle), STATE_COLORS.benched);
  assert.notEqual(colorForAgent(idle), STATE_COLORS.working);
  assert.equal(iconForAgent(idle), null, 'it asks for nothing, so it carries no mark');
  // The user's own choices still win: a fired session is fired, idle or not.
  assert.equal(stateForAgent({ ...idle, ackState: 'let_go' }), 'let_go');
});

test('an idle session at its desk does not type', () => {
  assert.equal(clipForActivity('working'), 'type');
  assert.equal(initialClipFor(working, 'desk'), 'type');
  assert.equal(initialClipFor(idle, 'desk'), 'stand_wait');
});

test('the panel draws the same robot and names it Idle', () => {
  assert.equal(visualState(working), 'working');
  assert.equal(visualState(idle), 'benched');
  assert.equal(IDLE_LABEL, 'Idle');
});

test('the reply box sends on Ctrl+Enter or Cmd+Enter, and on nothing else', () => {
  assert.equal(isSendKey({ key: 'Enter', ctrlKey: true }), true);
  assert.equal(isSendKey({ key: 'Enter', metaKey: true }), true);
  assert.equal(isSendKey({ key: 'Enter' }), false, 'Enter alone is a new line');
  assert.equal(isSendKey({ key: 'Enter', shiftKey: true }), false);
  assert.equal(isSendKey({ key: 'a', ctrlKey: true }), false);
  assert.equal(isSendKey({ key: 'Enter', ctrlKey: true, isComposing: true }), false);
  assert.equal(isSendKey(null), false);
});

test('idle is not working, in the header and in the room', () => {
  const agent = (id, over) => ({
    id,
    projectId: 'p',
    projectName: 'p',
    cwd: '/p',
    ackState: 'active',
    activityState: 'working',
    tokens: 0,
    cacheTokens: 0,
    ...over,
  });
  const floor = [agent('a'), agent('b', { idle: true }), agent('c', { idle: true })];
  const c = counts(/** @type {any} */ (floor));
  assert.equal(c.working, 1);
  assert.equal(c.idle, 2);
  assert.equal(c.needsYou, 0);
  const room = projects(/** @type {any} */ (floor))[0];
  assert.equal(room.working, 1);
  assert.equal(room.idle, 2);
  assert.equal(room.activeCount, 3, 'an idle session is still in its room');
});
