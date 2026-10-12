/**
 * A ZOOMED VIEW STAYS ON ITS ROOM WHEN THE BUILDING IS LAID AGAIN.
 *
 * A re-plan moves rooms, so the old pan is meaningless; it used to be dropped
 * and the floor centred. Zoomed in on one room, that threw the reader to the
 * middle of the building whenever a panel opened or a session left. The view
 * now remembers the room under its middle, and where in that room, and goes
 * back there on the new plan.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { panForAnchor, viewAnchorOf } from '../../public/render/scene-camera.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VIEW = { w: 1600, h: 900 };

/** A floor: two project rooms with a corridor between them, and an office. */
const before = {
  rooms: [
    { id: 'office', kind: 'office', x: 0, y: 0, w: 20, h: 14 },
    { id: 'hall', kind: 'corridor', x: 20, y: 0, w: 2, h: 14 },
    { id: 'a', kind: 'project', x: 22, y: 0, w: 16, h: 14 },
    { id: 'b', kind: 'project', x: 38, y: 0, w: 16, h: 14 },
  ],
};
/** The same floor laid again: narrower stage, room b moved under room a. */
const after = {
  rooms: [
    { id: 'office', kind: 'office', x: 0, y: 0, w: 18, h: 12 },
    { id: 'hall', kind: 'corridor', x: 18, y: 0, w: 2, h: 26 },
    { id: 'a', kind: 'project', x: 20, y: 0, w: 14, h: 12 },
    { id: 'b', kind: 'project', x: 20, y: 14, w: 14, h: 12 },
  ],
};

/** The pan that puts world point (wx, wy) in the middle of the view. */
const lookAt = (wx, wy, scale) => ({
  panX: VIEW.w / 2 - wx * scale,
  panY: VIEW.h / 2 - wy * scale,
});

test('the anchor is the room under the middle of the view, and where in it', () => {
  const scale = 60;
  // Looking at a point a quarter across and half down room b.
  const anchor = viewAnchorOf(before, lookAt(38 + 4, 7, scale), scale, VIEW.w, VIEW.h);
  assert.deepEqual(anchor, { id: 'b', fx: 0.25, fy: 0.5 });
});

test('on the new plan the same point of the same room is in the middle again', () => {
  const scale = 60;
  const anchor = viewAnchorOf(before, lookAt(38 + 4, 7, scale), scale, VIEW.w, VIEW.h);
  // The new building is drawn at another scale, as a narrower stage would have it.
  const next = 52;
  const pan = panForAnchor(after, anchor, next, VIEW.w, VIEW.h);
  assert.ok(pan);
  // Where is room b's quarter-across, half-down point on screen now?
  const sx = (20 + 0.25 * 14) * next + pan.panX;
  const sy = (14 + 0.5 * 12) * next + pan.panY;
  assert.ok(Math.abs(sx - VIEW.w / 2) < 1e-6, `x ${sx}`);
  assert.ok(Math.abs(sy - VIEW.h / 2) < 1e-6, `y ${sy}`);
});

test('a view centred in a corridor holds on to the nearest room, never to the corridor', () => {
  const scale = 60;
  const anchor = viewAnchorOf(before, lookAt(21, 7, scale), scale, VIEW.w, VIEW.h);
  assert.ok(anchor);
  assert.notEqual(anchor.id, 'hall');
  assert.ok(['office', 'a'].includes(anchor.id));
});

test('a room that is gone, or nothing to hold, gives no pan: the floor is centred instead', () => {
  const gone = { id: 'closed-project', fx: 0.5, fy: 0.5 };
  assert.equal(panForAnchor(after, gone, 60, VIEW.w, VIEW.h), null);
  assert.equal(panForAnchor(after, null, 60, VIEW.w, VIEW.h), null);
  assert.equal(viewAnchorOf(null, { panX: 0, panY: 0 }, 60, VIEW.w, VIEW.h), null);
  assert.equal(viewAnchorOf({ rooms: [] }, { panX: 0, panY: 0 }, 60, VIEW.w, VIEW.h), null);
});

test('the re-plan uses it only when the reader has zoomed in', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'render', 'scene-draw.js'), 'utf8');
  assert.match(src, /this\._zoom > ZOOM_MIN \+ 1e-6\s*\?\s*viewAnchorOf\(/);
  assert.match(src, /panForAnchor\(this\._plan, anchor/);
  // At the fit scale nothing changed: the floor is still centred.
  assert.match(src, /else \{\s*this\._centerCamera\(\);\s*\}/);
});
