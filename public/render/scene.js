/**
 * DeckHQ — the floor scene: frame loop, the fit-to-window camera, hit-testing, painter order.
 *
 * Owns the canvas entirely. All character logic (position, walking, seating,
 * activity rotation) lives in `./agents.js`, which is DOM-free and unit-tested
 * on its own; this file is the thin, untestable-without-a-browser layer that
 * wires that logic to a `<canvas>`.
 *
 * Depends on `./plan.js`, `./backdrop.js`, `./rig.js`, `./clips.js` and
 * `./palette.js` (docs/CONTRACTS.md). Those were being written concurrently
 * by other engineers as this file was authored; they have since landed and
 * this file imports their real exports directly. See the note at the bottom
 * of this file for what that concurrency means for testing this module.
 *
 * ============================================================================
 * WP-22 follow-up · this file is the Scene's shell: the constructor, the
 * lifecycle (`setState`, `start`/`stop`, `destroy`) and the public API app.js
 * calls. Everything else is eight modules:
 *
 *   scene-base.js    the instance shape, declared once
 *   scene-lod.js     px-per-unit, and how big a character is drawn at it
 *   scene-camera.js  the fit-to-viewport camera and its pure arithmetic
 *   scene-labels.js  the room plates and the label collision pass
 *   scene-hit.js     anchors, the fixtures, and what is under the pointer
 *   scene-draw.js    the rebuild, the frame loop and painter order
 *   scene-input.js   every listener the canvas owns, and the zoom API
 *   scene-agent.js   colour, label and glyph — the mini-floor's target
 *
 * The seven that carry methods are one chain of base classes:
 *
 *   SceneBase → SceneLod → SceneCamera → SceneLabels → SceneHit → SceneDraw
 *     → SceneInput → Scene
 *
 * A chain rather than a mixin because the type checker follows a chain: with
 * `Object.assign` onto the prototype, `this._draw()` inside `setState()` is
 * an error the compiler cannot see past, and this repository has no
 * `@ts-ignore` anywhere (docs/DEVIATIONS.md §122). The order is the call
 * graph's own: nothing in it calls upwards.
 *
 * Method bodies are the class's own, character for character, at the same
 * indentation. The one consequence is the `super()` on the constructor's
 * first line, which a derived class requires.
 *
 * Every name the old module exported is re-exported here, so `minifloor.js`,
 * `app-floor.js` and three test files import what they always imported.
 * ============================================================================
 */

import { bakeBackdrop } from './backdrop.js';
import { AgentRuntime, assignSeats } from './agents.js';
import { computeTargetAspect } from './scene-camera.js';
import { makeActivityRotation } from './clips.js';
import { SceneInput } from './scene-input.js';
import { planSignature } from './scene-draw.js';

export * from './scene-base.js';
export * from './scene-lod.js';
export * from './scene-camera.js';
export * from './scene-labels.js';
export * from './scene-hit.js';
export * from './scene-draw.js';
export * from './scene-input.js';
export * from './scene-agent.js';

export class Scene extends SceneInput {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{onSelect?: (sel:{kind:'agent'|'project', id:string})=>void, onHover?: (sel:{kind:'agent'|'project', id:string}|null)=>void}} [handlers]
   */
  constructor(canvas, { onSelect, onHover } = {}) {
    // Required of a derived class before `this`. Nothing above this one
    // declares a constructor; the chain is method bodies and the field
    // declarations in `scene-base.js`.
    super();
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this._onSelect = onSelect || (() => {});
    this._onHover = onHover || (() => {});

    // Centring offset that places the always-fitted floor in the stage —
    // non-zero only on the slack axis, when the floor's aspect isn't an
    // exact match for the viewport's (see `_centerCamera`). There is no user
    // pan any more; this is not camera state a person can move.
    this._camera = { panX: 0, panY: 0 };
    // Px-per-unit that exactly fits the current plan into the current
    // viewport — recomputed on plan change and on every resize
    // (`_recomputeFitScale`). This is the only scale the floor is ever drawn
    // at.
    this._fitScale = 1;
    /**
     * Magnification on top of the fit scale. 1.0 IS fit-to-window and is the
     * minimum — there is no zooming out past the floor.
     */
    this._zoom = 1;
    /** Pointer id of an in-progress drag-to-pan, and where it last was. */
    this._dragPointer = null;
    this._dragFrom = null;
    this._dragMoved = 0;
    this._viewW = 0;
    this._viewH = 0;
    this._resizeDebounceTimer = null;
    this._plan = null;
    this._planSignature = null;
    this._backdrop = null;
    /**
     * The floor the last re-plan replaced, kept only long enough to fade it
     * out under the new one (`REPLAN_FADE_MS`). See `_rebuildPlan`.
     * @type {{backdrop:any, plan:any, scale:number, camera:{panX:number,panY:number}}|null}
     */
    this._fadeFrom = null;
    this._fadeStartedAt = 0;
    this._snapshot = { agents: [], projects: [], counts: {} };
    this._agentsById = new Map();
    this._plateRects = []; // screen-space rects for hit-testing, refreshed each draw
    // The "+" (circle) and the shelf/screen/whiteboard (rect) hit regions,
    // screen-space, refreshed each draw — see `_drawRoomFixtures`/`_hitTest`.
    this._fixtureRects = [];

    this._runtime = new AgentRuntime();
    this._selectedId = null;
    // The last hit reported through onHover — `{kind, id}` or null. Tracks
    // every hoverable kind (agent, whiteboard, shelf, screen, the "+"), not
    // just agents, both to de-duplicate onHover calls and so the "+" can
    // render its own hover state (see `_drawPlusAffordance`).
    this._hoveredTarget = null;

    this._running = false;
    this._frameErrorLogged = false;
    this._wantRunning = false;
    this._raf = null;
    this._lastT = 0;

    this._dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;

    this._reducedMotionQuery =
      typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    this._reduced = this._reducedMotionQuery ? this._reducedMotionQuery.matches : false;

    // A back-reference from the element to its scene. The floor is a single
    // canvas, so there is otherwise no way to reach the camera or the baked
    // backdrop from the console when something on screen does not match the
    // plan that produced it.
    canvas.__deckhqScene = this;

    if (canvas.setAttribute) {
      canvas.setAttribute('role', 'img');
      if (canvas.tabIndex == null || canvas.tabIndex < 0) canvas.tabIndex = 0;
    }

    this._bind();
    this._resizeCanvasBacking();
    this._recomputeFitScale();
  }

  // ------------------------------------------------------------- lifecycle

  /** Push a fresh state snapshot ({agents, projects, counts, ...}). */
  setState(snapshot) {
    const previousAgents = (this._snapshot && this._snapshot.agents) || [];
    this._snapshot = snapshot || { agents: [], projects: [], counts: {} };
    const agents = this._snapshot.agents || [];
    this._agentsById = new Map(agents.map((a) => [a.id, a]));

    // Content-driven rebuild: the project/session-count signature changed
    // (room sizes and furniture counts are derived from it, per
    // 05-LAYOUT-REWORK.md §2.1). This is independent of, and not debounced
    // like, the resize-driven aspect rebuild in `_checkAspectRebuild` — a
    // genuine new snapshot is not a per-pixel window-drag event. `_rebuildPlan`
    // itself keeps the floor centred at its one fit scale, so there is no
    // separate first-fit step to do here.
    const signature = planSignature(this._snapshot);
    if (signature !== this._planSignature) {
      this._rebuildPlan(computeTargetAspect(this._viewW, this._viewH));
      this._planSignature = signature;
      // The signature counts who is waiting, benched and let go, so the very
      // change that should be seen as a walk — a turn ends and the agent
      // heads for your office — is also a rebuild, and the runtime snaps the
      // whole floor on a rebuilt plan (see `sync`). Bridge it: seat everybody
      // in the new building where they *were*, as one snap, and only then
      // apply the new snapshot, so the agents whose own state changed walk
      // from their old seat to their new one and nobody else moves.
      if (this._plan) {
        this._runtime.sync(previousAgents, this._plan, assignSeats(this._plan, previousAgents));
      }
    }

    if (this._plan) {
      const seatMap = assignSeats(this._plan, agents);
      this._runtime.sync(agents, this._plan, seatMap);
    }

    if (this.canvas.setAttribute) {
      this.canvas.setAttribute('aria-label', Scene.describeFloor(this._snapshot));
    }

    if (!this._running) this._draw(); // keep the floor current even if the loop is paused (hidden tab)
  }

  /**
   * Re-bake the backdrop for the plan already in hand, and draw it (WP-30).
   *
   * A theme changes no geometry, so there is nothing to re-plan — but the
   * floor is a BAKED bitmap, and a material that changed in `PALETTE` reaches
   * the screen only when something bakes. `planSignature` counts the theme, so
   * the next snapshot would eventually do it; "eventually" is the problem.
   * The floor is push-driven: with nobody starting or finishing a session, no
   * snapshot arrives, and choosing a theme would repaint the chrome instantly
   * and leave the floor on the old one until the next thing happened. Measured
   * on the demo floor before this existed.
   *
   * Cheap enough to call on a hover preview: one bake, the same one a re-plan
   * already does, and `docs/02-ARCHITECTURE.md` §8 budgets it at under 400 ms
   * for a floor far larger than any real one.
   */
  repaint() {
    if (!this._plan) return;
    this._backdrop = bakeBackdrop(this._plan, this._dpr);
    // No cross-fade: the old bitmap is the same building in different paint,
    // so fading between them reads as a flicker rather than as a change.
    this._fadeFrom = null;
    this._draw();
  }

  /**
   * The agents the floor is not drawing because they went home — benched, and
   * quiet for longer than `settings.goneHomeDays`.
   *
   * Newest activity first, which is the order somebody looking for one wants
   * them in. The floor is the only surface that hides them; the header still
   * counts them, the panel still lists them, and this is what lets a keyboard
   * command reach them in one keystroke (`08` WP-40's acceptance).
   * @returns {string[]}
   */
  goneHomeAgentIds() {
    const ids = this._plan && this._plan.goneHome ? [...this._plan.goneHome] : [];
    const lastActivity = (id) => (this._agentsById.get(id) || {}).lastActivityAt || 0;
    return ids.sort(
      (a, b) => lastActivity(b) - lastActivity(a) || String(a).localeCompare(String(b)),
    );
  }

  /**
   * Summarise the floor for the canvas `aria-label` / the off-screen live
   * region app.js owns. docs/03-VISUAL-SPEC.md §10.
   * @param {{projects?: any[], counts?: Record<string, number>}} snapshot
   */
  static describeFloor(snapshot) {
    const projectsCount = ((snapshot && snapshot.projects) || []).length;
    const c = (snapshot && snapshot.counts) || {};
    const needsYou = c.needsYou || 0;
    const parts = [];
    if (c.handsUp) parts.push(`${c.handsUp} hand${c.handsUp === 1 ? '' : 's'} up`);
    if (c.forReview) parts.push(`${c.forReview} for review`);
    if (c.stalled) parts.push(`${c.stalled} stalled`);
    const breakdown = parts.length ? `: ${parts.join(', ')}` : '';
    return `${projectsCount} project${projectsCount === 1 ? '' : 's'}, ${needsYou} session${
      needsYou === 1 ? '' : 's'
    } need you${breakdown}`;
  }

  /** Programmatic selection (e.g. keyboard queue navigation in app.js). */
  select(agentId) {
    this._selectedId = agentId || null;
  }

  // ------------------------------------------------- a second render target
  //
  // WP-39's mini-floor is not a second scene. A second scene would mean a
  // second `buildPlan`, a second backdrop bake, a second AgentRuntime and
  // therefore a second set of positions — two buildings that would drift
  // apart the moment one of them missed a frame, and two answers to "where is
  // Ada standing". These two methods let another canvas paint THIS scene's
  // state instead: `frame()` hands out what it is drawing right now, and
  // `stepIfPaused()` keeps it moving while this canvas's own loop is stopped.

  /**
   * Everything a second canvas needs to draw this scene's current frame.
   *
   * Read-only by contract, and deliberately the live objects rather than
   * copies: the records are stepped 60 times a second and cloning them per
   * frame would cost more than the mini-floor's whole draw.
   * @returns {{plan:any, backdrop:{canvas:any,wpx:number,hpx:number}|null,
   *   records:any[], agentsById:Map<string,any>, snapshot:any,
   *   selectedId:string|null, reduced:boolean}}
   */
  frame() {
    return {
      plan: this._plan,
      backdrop: this._backdrop,
      records: [...this._runtime.all()],
      agentsById: this._agentsById,
      snapshot: this._snapshot,
      selectedId: this._selectedId,
      reduced: this._reduced,
    };
  }

  /**
   * Advance the floor's people by `dt` seconds WITHOUT drawing them, but only
   * while this canvas's own loop is stopped.
   *
   * The loop stops when the tab is hidden, which is exactly when the
   * mini-floor is the only thing on screen — and a stopped runtime means an
   * agent whose turn just ended is given a path to your office and never walks
   * it, so the floating window would show a stale office for as long as the
   * tab stayed in the background. The guard is what makes this safe to call
   * every mini-floor frame: while the main floor is running it does nothing,
   * so nobody is ever stepped twice.
   * @param {number} dtSeconds
   * @returns {boolean} whether this call actually stepped anything
   */
  stepIfPaused(dtSeconds) {
    if (this._running) return false;
    const dt = Math.min(0.25, Math.max(0, Number(dtSeconds) || 0));
    if (dt === 0) return false;
    this._runtime.step(dt, { reduced: this._reduced, plan: this._plan, makeActivityRotation });
    return true;
  }

  start() {
    this._wantRunning = true;
    if (this._running) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    this._startLoop();
  }

  stop() {
    this._wantRunning = false;
    this._stopLoop();
  }

  destroy() {
    this._stopLoop();
    if (this._resizeDebounceTimer != null) {
      clearTimeout(this._resizeDebounceTimer);
      this._resizeDebounceTimer = null;
    }
    this.canvas.removeEventListener('wheel', this._onWheel);
    this.canvas.removeEventListener('pointerdown', this._onPointerDown);
    this.canvas.removeEventListener('pointermove', this._onPointerMove);
    this.canvas.removeEventListener('pointerleave', this._onPointerLeave);
    this.canvas.removeEventListener('pointerup', this._onPointerUp);
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this._onResize);
    }
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this._onVisibilityChange);
    }
    if (this._reducedMotionQuery) {
      if (this._reducedMotionQuery.removeEventListener) {
        this._reducedMotionQuery.removeEventListener('change', this._onReducedMotionChange);
      } else if (this._reducedMotionQuery.removeListener) {
        this._reducedMotionQuery.removeListener(this._onReducedMotionChange);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// A note on testing this file: `new Scene(...)` needs a `<canvas>` (2D
// context), `document` and `window`, none of which are available under
// `node --test`, so the class itself is not exercised there. But every
// import in this module's chain (`plan.js`, `backdrop.js`, `rig.js`,
// `clips.js`, `palette.js`, `agents.js`) is side-effect-free at module scope,
// which is why the pure camera/label functions above (`computeTargetAspect`,
// `shouldRebuildAspect`, `computeFitScale`, `resolveLabelCollisions`) are
// plain named exports rather than methods: `test/unit/scene-math.test.mjs`
// imports this file directly (alongside `./agents.js` and `./rig.js`) and
// exercises them with no DOM at all. Everything that genuinely needs a live
// canvas — the constructor, event wiring, `_draw`'s actual paint calls — was
// verified with `node --check` (syntax) and by importing the module under
// Node to confirm every sibling export it consumes exists with the shape
// used here. Full interactive verification (hit-testing/reduced-motion on
// screen) still needs a browser.
