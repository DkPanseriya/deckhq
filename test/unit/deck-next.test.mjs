/**
 * Inbox flow in the deck: after you approve, bench or reply to an item, the
 * card moves on to the next one waiting (the owner, 25 October 2026: "I never
 * respond from it"). The acted item leaves the queue with the next snapshot,
 * which can land before the action's own answer, so the order it was drawn in
 * the time before is what says who is next.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextWaiting } from '../../public/deck-view.js';

test('the next one is the one after it that is still waiting', () => {
  const drawn = ['a', 'b', 'c', 'd'];
  assert.equal(nextWaiting([drawn], ['a', 'b', 'c', 'd'], 'b'), 'c');
  assert.equal(nextWaiting([drawn], ['a', 'b', 'd'], 'b'), 'd', 'c answered meanwhile');
});

test('acted on and already gone from the queue: the order drawn before still says', () => {
  const now = ['a', 'c', 'd'];
  const before = ['a', 'b', 'c', 'd'];
  assert.equal(nextWaiting([now, before], now, 'b'), 'c');
});

test('at the end of the queue it goes back one, and with nobody left it stays', () => {
  assert.equal(nextWaiting([['a', 'b', 'c']], ['a', 'b', 'c'], 'c'), 'b');
  assert.equal(nextWaiting([['a']], ['a'], 'a'), null);
  assert.equal(nextWaiting([['a', 'b']], [], 'a'), null);
  assert.equal(nextWaiting([['a', 'b']], ['a', 'b'], 'z'), null, 'never drawn: no guess');
});
