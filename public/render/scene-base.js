/**
 * The Scene's instance shape, declared once (WP-22 follow-up).
 *
 * `scene.js` was 1,985 lines and its class was 1,386 of them. Splitting the
 * class into a chain of base classes — each holding the class body's own
 * lines, character for character — needs the fields declared somewhere every
 * link can see them, because the constructor that assigns them is in the last
 * link.
 *
 * So they are declared here and assigned exactly where they always were.
 * A field declaration with no initialiser is `undefined` until the
 * constructor runs, which is what "not yet assigned" already meant.
 *
 * This is also the only written-down list of what a Scene actually holds,
 * which the 1,386-line class never had.
 */
export class SceneBase {
  /** @type {HTMLCanvasElement} */ // the canvas this scene owns entirely
  canvas;
  /** @type {CanvasRenderingContext2D} */ // its 2D context, fetched once in the constructor
  ctx;
  /** @type {(sel: any) => void} */ // app.js's click handler
  _onSelect;
  /** @type {(sel: any) => void} */ // app.js's hover handler
  _onHover;
  /** @type {any} */ // the centring offset that places the fitted floor in the stage
  _camera;
  /** @type {number} */ // px-per-unit that exactly fits the plan into the viewport
  _fitScale;
  /** @type {number} */ // always 1: magnification was removed as a feature
  _zoom;
  /** @type {number} */ // the viewport, last measured
  _viewW;
  /** @type {number} */
  _viewH;
  /** @type {number} */ // device pixel ratio the backing store was sized for
  _dpr;
  /** @type {any} */ // the last snapshot handed to setState()
  _snapshot;
  /** @type {any} */ // the built floor plan; null until the first rebuild
  _plan;
  /** @type {string|null} */ // what decides whether the plan must be rebuilt
  _planSignature;
  /** @type {any} */ // the baked backdrop bitmap
  _backdrop;
  /** @type {any} */ // agents.js's AgentRuntime, which owns every character
  _runtime;
  /** @type {any} */ // the snapshot rows, by id
  _agentsById;
  /** @type {string|null} */ // what the panel is open on
  _selectedId;
  /** @type {any} */ // what the pointer is over, for the hover card
  _hoveredTarget;
  /** @type {any} */ // where each room plate was painted, for hit-testing
  _plateRects;
  /** @type {any} */ // where the shelf/screen/whiteboard/+ were painted
  _fixtureRects;
  /** @type {any} */ // the outgoing backdrop during a replan cross-fade
  _fadeFrom;
  /** @type {number} */ // when that fade began
  _fadeStartedAt;
  /** @type {number|null} */ // the animation frame handle
  _raf;
  /** @type {boolean} */ // whether the loop is actually running
  _running;
  /** @type {boolean} */ // whether it should be, tab visibility aside
  _wantRunning;
  /** @type {number} */ // the previous frame timestamp
  _lastT;
  /** @type {boolean} */ // a broken frame is reported once, not per frame
  _frameErrorLogged;
  /** @type {boolean} */ // prefers-reduced-motion, as last read
  _reduced;
  /** @type {any} */ // the media query it is read from
  _reducedMotionQuery;
  /** @type {any} */ // the observer on the stage
  _resizeObserver;
  /** @type {any} */ // coalesces a burst of resizes
  _resizeDebounceTimer;
  /** @type {any} */ // the pointer id currently down, if any
  _dragPointer;
  /** @type {any} */ // where it went down
  _dragFrom;
  /** @type {number} */ // how far it has travelled, for the click/drag threshold
  _dragMoved;
}
