/**
 * Where a thing is on screen, and what is under the pointer
 * (WP-22 follow-up).
 *
 * Split out of `scene.js` unchanged: the fixture constants and the hit-test
 * priority they encode, `computeAnchor` — the pure one
 * `test/unit/coach-marks.test.mjs` reads — the public `anchorFor`, and the
 * two hit tests themselves.
 *
 * Hit-testing is a read. It decides what a click is ABOUT and never acts on
 * it; the acting is app.js's, through the panel (docs/01-PRODUCT.md §2).
 */

import { U } from './plan.js';
import { worldToScreen, screenToWorld } from './agents.js';
import { BODY_HEIGHT_U, SELECTION_RING_R } from './rig.js';
import { SceneLabels } from './scene-labels.js';

export const HIT_RADIUS_PX = 20;

// Interactive floor fixtures (CONTRACTS-WP15.md §4 whiteboard, §5 the
// in-room "+", and the shelf/screen addendum). Hit-test priority, highest
// first: the "+", the shelf, the screen, the whiteboard, a character, the
// room plate — small targets that sit near furniture must win over the
// character standing behind them, and a click on the "+" must never select
// the agent behind it (see `_hitTest`).
export const PLUS_SIZE_U = 1.5; // the "+" glyph's own half-length, plan units
export const PLUS_MARGIN_U = 1.7; // inset from the room's north/east walls — "the room's top-right corner area is free"
export const PLUS_HIT_RADIUS_PX = 15;
export const FIXTURE_HIT_PAD_PX = 6; // generous click padding around shelf/screen/whiteboard rects

/**
 * The screen-space box a thing on the floor occupies, given the floor's plan
 * and camera. The arithmetic behind `Scene#anchorFor` — see that method for
 * what it is for and what the coordinates mean.
 *
 * A plain named export rather than only a method, for the reason the note at
 * the bottom of this file gives: `new Scene(...)` needs a canvas, a document
 * and a window, so anything that must be unit-tested lives out here where a
 * stub plan is enough.
 *
 * `'project'` is accepted as a synonym for `'room'`: `docs/DEVIATIONS.md` §108.1
 * states the request in those words and the orchestrator's in the other, and a
 * caller that guesses wrong should get the room rather than a null.
 *
 * @param {'office'|'agent'|'room'|'project'|'lounge'} target
 * @param {string|undefined|null} id agent id for `'agent'`, project id for `'room'`
 * @param {{plan:any, camera:{zoom:number,panX:number,panY:number,U:number},
 *   scale:number, charScale:number, record?:any}} view
 * @returns {{x:number, y:number, w:number, h:number}|null}
 */
export function computeAnchor(target, id, view) {
  const plan = view && view.plan;
  if (!plan || !view.camera) return null;
  const rooms = plan.rooms || [];

  if (target === 'office' || target === 'lounge' || target === 'room' || target === 'project') {
    const room =
      target === 'office' || target === 'lounge'
        ? rooms.find((r) => r && r.kind === target)
        : rooms.find((r) => r && r.kind === 'project' && String(r.id) === String(id));
    if (!room) return null;
    // The room's whole footprint as it is drawn, plate band included — the
    // plate is part of the room a person sees, and a mark that pointed at the
    // carpet alone would sit under the room's own name.
    const topLeft = worldToScreen({ x: room.x, y: room.y }, view.camera);
    return { x: topLeft.x, y: topLeft.y, w: room.w * view.scale, h: room.h * view.scale };
  }

  if (target === 'agent') {
    if (!id) return null;
    // An agent the plan is deliberately not drawing — went home, or at a desk
    // in a project with no room — has a position and no presence. There is
    // nothing on screen to point at.
    if (plan.hidden && plan.hidden.has(String(id))) return null;
    const rec = view.record;
    if (!rec || !rec.initialised) return null;
    // A character is drawn at the CHARACTER scale, not the world scale, and
    // its `x,y` is where its feet touch the floor: the box runs up from there
    // by a body's height, and out either side by the radius of the ring the
    // interface already draws to mean "this one".
    const feet = worldToScreen(rec, view.camera);
    const w = 2 * SELECTION_RING_R * view.charScale;
    const h = BODY_HEIGHT_U * view.charScale;
    return { x: feet.x - w / 2, y: feet.y - h, w, h };
  }

  return null;
}

export class SceneHit extends SceneLabels {
  /**
   * Where something on the floor is, in screen pixels, right now.
   *
   * The inverse of `_hitTest`: that turns a point into a thing, this turns a
   * thing into the box it occupies. It exists so a caller that has to place
   * chrome OVER the floor — WP-13's coach marks, and anything after them —
   * can point at the office or at one person without a second copy of the
   * camera arithmetic, which is the class of duplication that has produced
   * three separate defects in this renderer already.
   *
   * Coordinates are CSS pixels **relative to the canvas's own top-left**,
   * which is the frame `getBoundingClientRect()` puts the canvas in — add the
   * canvas's own rect to place something in the page.
   *
   * A pure read: it computes from the current plan, camera and runtime and
   * changes nothing. It is also a snapshot, not a subscription — the floor
   * moves, so a caller holding a rect across frames is holding a stale one.
   *
   * Returns `null` whenever the thing is not on the floor to be pointed at: no
   * plan yet, no room by that id, no record for that agent, or an agent the
   * plan is deliberately not drawing (`plan.hidden` — went home, or at a desk
   * in a project with no room). A rect is never invented for something that
   * is not there.
   *
   * @param {'office'|'agent'|'room'|'project'|'lounge'} target
   * @param {string} [id] the agent id for `'agent'`, the project id for `'room'`
   * @returns {{x:number, y:number, w:number, h:number}|null}
   */
  anchorFor(target, id) {
    if (!this._plan) return null;
    return computeAnchor(target, id, {
      plan: this._plan,
      camera: this._cameraParams(),
      scale: this._scale(),
      charScale: this._characterScale(),
      record: target === 'agent' && id ? this._runtime.get(String(id)) : null,
    });
  }

  /**
   * @param {number} sx screen-space (CSS px) x
   * @param {number} sy screen-space (CSS px) y
   */
  _hitTest(sx, sy) {
    if (!this._plan) return null;

    // Highest priority, in order: the "+", the shelf, the screen, the
    // whiteboard — each tested as its own pass over `_fixtureRects` (built
    // fresh every draw by `_drawRoomFixtures`) rather than by array push
    // order, so the priority holds regardless of how that array was filled.
    // A click on the "+" (or any of these) must never fall through to the
    // character or room plate that might sit behind or near it.
    for (const kind of /** @type {const} */ (['new-agent', 'shelf', 'screen', 'whiteboard'])) {
      const hit = this._hitTestFixtureKind(sx, sy, kind);
      if (hit) return hit;
    }

    const camera = this._cameraParams();
    const world = screenToWorld({ x: sx, y: sy }, this._cameraParams());
    // `camera.zoom` here is the U-normalised fit scale from `_cameraParams()`
    // — hit-testing needs the real px-per-unit, which is all that number is.
    const hitRadiusWorld = HIT_RADIUS_PX / (U * camera.zoom);
    let best = null;
    let bestDist = Infinity;
    for (const rec of this._runtime.all()) {
      const d = Math.hypot(rec.x - world.x, rec.y - world.y);
      if (d <= hitRadiusWorld && d < bestDist) {
        bestDist = d;
        best = rec;
      }
    }
    if (best) return { kind: 'agent', id: best.id };

    for (const plate of this._plateRects) {
      if (sx >= plate.x && sx <= plate.x + plate.w && sy >= plate.y && sy <= plate.y + plate.h) {
        if (plate.kind === 'project') return { kind: 'project', id: plate.id };
      }
    }
    return null;
  }

  /**
   * Hit-test just one fixture kind within `_fixtureRects` — a circle for the
   * "+", a padded rect for shelf/screen/whiteboard. Kept as its own pass
   * (called once per kind, in priority order, from `_hitTest`) rather than
   * one generic scan so priority is explicit and independent of paint order.
   * @param {number} sx @param {number} sy
   * @param {'new-agent'|'shelf'|'screen'|'whiteboard'} kind
   */
  _hitTestFixtureKind(sx, sy, kind) {
    for (const f of this._fixtureRects) {
      if (f.kind !== kind) continue;
      if (f.circle) {
        if (Math.hypot(sx - f.cx, sy - f.cy) <= f.r) return { kind: f.kind, id: f.id };
      } else {
        const pad = FIXTURE_HIT_PAD_PX;
        if (sx >= f.x - pad && sx <= f.x + f.w + pad && sy >= f.y - pad && sy <= f.y + f.h + pad) {
          return { kind: f.kind, id: f.id };
        }
      }
    }
    return null;
  }

  /**
   * A `Prop`'s (plan.js) top-left plan-unit rect, converted to a screen-space
   * rect at the current camera. Props this file cares about (whiteboard,
   * shelf, screen) are all axis-aligned (`angle: 0`), so this ignores
   * rotation — consistent with `_plateRects` also being simple axis-aligned
   * rects.
   * @param {{x:number,y:number,w:number,h:number}} prop
   * @param {{zoom:number,panX:number,panY:number,U:number}} camera
   */
  _propRectScreen(prop, camera) {
    const topLeft = worldToScreen({ x: prop.x, y: prop.y }, camera);
    const u = U * camera.zoom;
    return { x: topLeft.x, y: topLeft.y, w: prop.w * u, h: prop.h * u };
  }
}
