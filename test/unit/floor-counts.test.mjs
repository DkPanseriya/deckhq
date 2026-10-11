// The header's floor counts (public/floor-counts.js): the number beside "resting" is the Lounge
// plate's own, and what it is made of can be said.
import test from 'node:test';
import assert from 'node:assert/strict';

import { floorCounts, restingTitle } from '../../public/floor-counts.js';

test('resting is everybody the lounge holds: the benched and the ended', () => {
  // The demo floor's own numbers: nine benched, six ended, fifteen on the plate.
  const got = floorCounts({ benched: 9, atDesk: 6, drawn: { atDesk: 6, benched: 9, lounge: 15 } });
  assert.equal(got.resting, 15);
  assert.equal(got.benched, 9);
  assert.equal(got.ended, 6);
  assert.equal(got.atDesk, 6);
  assert.equal(got.restingTitle, 'In the Lounge: 9 you benched, 6 ended.');
});

test('the two that are drawn nowhere are passed through, and nought when absent', () => {
  const got = floorCounts({
    drawn: { atDesk: 2, benched: 4, lounge: 135, finished: 13, wentHome: 24 },
  });
  assert.deepEqual(
    { finished: got.finished, wentHome: got.wentHome, resting: got.resting, ended: got.ended },
    { finished: 13, wentHome: 24, resting: 135, ended: 131 },
  );
  const bare = floorCounts({ drawn: { atDesk: 1, benched: 0, lounge: 0 } });
  assert.deepEqual(
    { finished: bare.finished, wentHome: bare.wentHome },
    { finished: 0, wentHome: 0 },
  );
  assert.equal(bare.restingTitle, 'Nobody is in the Lounge.');
});

test('a snapshot from a daemon that sends no drawn counts still gives numbers', () => {
  // An older daemon: only `benched` and `atDesk`. Resting is then what it has.
  const got = floorCounts({ benched: 3, atDesk: 5 });
  assert.deepEqual(
    { atDesk: got.atDesk, resting: got.resting, benched: got.benched, ended: got.ended },
    { atDesk: 5, resting: 3, benched: 3, ended: 0 },
  );
  // And nothing at all is nought, never NaN.
  const none = floorCounts(undefined);
  assert.deepEqual({ atDesk: none.atDesk, resting: none.resting }, { atDesk: 0, resting: 0 });
});

test('the tooltip names only the halves that are there', () => {
  assert.equal(restingTitle(2, 0), 'In the Lounge: 2 you benched.');
  assert.equal(restingTitle(0, 7), 'In the Lounge: 7 ended.');
});
