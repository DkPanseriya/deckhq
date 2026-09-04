/**
 * The fit-to-viewport camera (WP-22 follow-up).
 *
 * Split out of `scene.js` unchanged. The floor is always exactly fitted:
 * zoom and drag-to-pan were removed as a feature, and what is left places the
 * fitted floor in the stage and feeds `agents.js`'s `worldToScreen` /
 * `screenToWorld` the camera shape they expect.
 *
 * The four pure functions here — `clamp`, `computeTargetAspect`,
 * `shouldRebuildAspect` and `computeFitScale` — are what
 * `test/unit/scene-math.test.mjs` and `coach-marks.test.mjs` exercise with no
 * DOM at all; `scene.js` re-exports them.
 */

import { U } from './plan.js';
import { SceneLod, MIN_SCALE, CHAR_MAX_PX_PER_UNIT } from './scene-lod.js';

// Plan-rebuild policy (CONTRACTS-WP13.md "Rebuild policy (scene.js)"): the
// stage's target aspect (same clamp `plan.js` applies internally, reproduced
// here so scene.js's drift check compares like with like), the drift
// tolerance before a rebuild is worth its ~190ms re-bake, and the resize
// debounce so a window drag doesn't trigger one per pixel.
/**
 * The floor takes the stage's shape. docs/05-LAYOUT-REWORK.md gives two rules
 * that cannot both hold: 2.2 clamps the target aspect to [1.60, 1.78], while
 * 3.1 requires the floor to fill the stage with no letterbox band wider than
 * 8 px at every size from 1280x720 to 2560x1440. Once the header is
 * subtracted those stages are about 1.85-1.93 wide, so the narrow clamp
 * guarantees a 100 px band on almost every real window.
 *
 * 3.1 is stated as the acceptance test and is the point of the rework, so the
 * clamp is widened to a range that still refuses genuinely absurd shapes.
 * Room proportions are protected separately and independently by
 * ROOM_ASPECT_MIN/MAX, so a wider floor cannot turn rooms into corridors.
 * Recorded in docs/DEVIATIONS.md.
 */
export const ASPECT_MIN = 1.2;
export const ASPECT_MAX = 2.2;
export const ASPECT_REBUILD_THRESHOLD = 0.02;
export const RESIZE_DEBOUNCE_MS = 150;

/**
 * Magnification range (05-LAYOUT-REWORK.md §2.4). 1.0 is exactly
 * fit-to-window and is the floor; there is no zooming out past it.
 */
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 2.5;
/** Wheel delta to zoom factor. One notch (~100px) is about 10%. */
export const ZOOM_WHEEL_RATE = 0.001;

/**
 * Smallest canvas box that counts as a real viewport. Below this the element
 * has not been laid out (or the host has collapsed the pane) and its
 * measurement must not be used to shape the floor.
 */
export const MIN_CREDIBLE_VIEW = 80;
export const DEFAULT_VIEW_W = 1600;
export const DEFAULT_VIEW_H = 900;

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

// ---------------------------------------------------------------------------
// Pure camera/label maths, exported so `test/unit/scene-math.test.mjs` can
// exercise them without a DOM (this file imports cleanly under plain Node —
// see the note at the bottom — so these are reachable exports, not just
// internal helpers).

/**
 * The floor's target aspect ratio for a given stage box.
 * Clamped to [ASPECT_MIN, ASPECT_MAX] — see the note on those constants.
 * @param {number} stageW @param {number} stageH
 * @returns {number}
 */
export function computeTargetAspect(stageW, stageH) {
  const w = Number(stageW) || 1;
  const h = Number(stageH) || 1;
  return clamp(w / h, ASPECT_MIN, ASPECT_MAX);
}

/**
 * True when the stage's current target aspect has drifted far enough from
 * the baked plan's `targetAspect` to be worth a rebuild (CONTRACTS-WP13.md
 * "Rebuild policy" — rebuild only when the difference exceeds 0.02, which is
 * also acceptance criterion 2's own tolerance).
 * @param {number} currentTargetAspect
 * @param {number} planTargetAspect
 * @returns {boolean}
 */
export function shouldRebuildAspect(currentTargetAspect, planTargetAspect) {
  return Math.abs(currentTargetAspect - planTargetAspect) > ASPECT_REBUILD_THRESHOLD;
}

/**
 * Px-per-unit that makes a `planW x planH` (unit) floor exactly *contain*
 * (fit entirely inside, no scroll/overflow) a `viewW x viewH` (px) stage.
 * This is the one and only scale the floor is ever drawn at — there is no
 * user zoom to multiply it by.
 * @param {number} planW @param {number} planH @param {number} viewW @param {number} viewH
 * @returns {number}
 */
export function computeFitScale(planW, planH, viewW, viewH) {
  const pw = Math.max(1e-6, Number(planW) || 0);
  const ph = Math.max(1e-6, Number(planH) || 0);
  const vw = Math.max(1, Number(viewW) || 0);
  const vh = Math.max(1, Number(viewH) || 0);
  return Math.min(vw / pw, vh / ph);
}

export class SceneCamera extends SceneLod {
  // ---------------------------------------------------------------- camera

  /**
   * Recompute the px-per-unit that exactly fits the current plan into the
   * current viewport (`_fitScale`) — the only scale the floor is ever drawn
   * at. Call on construction, on every resize, and after any plan rebuild;
   * never caches across those, so the floor stays exactly fitted everywhere
   * without special-casing that anywhere else.
   */
  _recomputeFitScale() {
    const rect = this.canvas.getBoundingClientRect();
    // A canvas that measures zero is not a viewport, it is a canvas that has
    // not been laid out yet — a hidden tab, a panel mid-transition, a pane the
    // host has collapsed. Taking that measurement at face value builds the
    // whole floor for a one-pixel stage: the target aspect clamps to its
    // minimum and the plan comes out nearly square, which then survives until
    // something happens to resize the window. Keep the last credible size.
    if (rect.width >= MIN_CREDIBLE_VIEW && rect.height >= MIN_CREDIBLE_VIEW) {
      this._viewW = rect.width;
      this._viewH = rect.height;
    } else if (!this._viewW || !this._viewH) {
      this._viewW = DEFAULT_VIEW_W;
      this._viewH = DEFAULT_VIEW_H;
    }
    const viewW = this._viewW;
    const viewH = this._viewH;
    const fit = this._plan ? computeFitScale(this._plan.width, this._plan.height, viewW, viewH) : U;

    // Fitting is preferred and is what happens for any normal number of
    // projects. But a floor can only be shrunk so far before a room stops
    // being readable, and past that point squeezing more projects in serves
    // nobody. Below MIN_SCALE the floor stops shrinking and the user pans
    // instead; above CHAR_MAX_PX_PER_UNIT it stops GROWING and the rest of the
    // viewport is the studio ground the building stands on (WP-55).
    this._fitScale = clamp(fit, MIN_SCALE, Math.max(MIN_SCALE, CHAR_MAX_PX_PER_UNIT));
    this._clampCamera();
  }

  /**
   * Keep the floor inside the stage.
   *
   * On an axis where the floor is smaller than the viewport there is nothing
   * to pan to, so it is centred and the offset is not a degree of freedom. On
   * an axis where it is larger, the pan is clamped so an edge of the floor can
   * never come inside the corresponding edge of the stage — the viewport can
   * never leave the building (05-LAYOUT-REWORK.md §2.4).
   */
  _clampCamera() {
    if (!this._plan) return;
    const scale = this._scale();
    const floorW = this._plan.width * scale;
    const floorH = this._plan.height * scale;
    const viewW = this._viewW || 1;
    const viewH = this._viewH || 1;
    this._camera.panX =
      floorW <= viewW ? (viewW - floorW) / 2 : clamp(this._camera.panX, viewW - floorW, 0);
    this._camera.panY =
      floorH <= viewH ? (viewH - floorH) / 2 : clamp(this._camera.panY, viewH - floorH, 0);
  }

  /** True when the floor is larger than the stage on either axis. */
  _pannable() {
    if (!this._plan) return false;
    const scale = this._scale();
    return (
      this._plan.width * scale > (this._viewW || 0) + 0.5 ||
      this._plan.height * scale > (this._viewH || 0) + 0.5
    );
  }

  /**
   * Centre the floor in the viewport, discarding any pan. Used on a plan
   * rebuild, where the old pan refers to a floor that no longer exists.
   */
  _centerCamera() {
    if (!this._plan) return;
    const scale = this._scale();
    this._camera.panX = ((this._viewW || 1) - this._plan.width * scale) / 2;
    this._camera.panY = ((this._viewH || 1) - this._plan.height * scale) / 2;
    this._clampCamera();
  }

  /**
   * The camera in the shape `agents.js`'s `worldToScreen`/`screenToWorld`
   * expect: `camera.U * camera.zoom` must equal the actual px-per-unit.
   *
   * There is ONE camera. An earlier revision pinned the office and the lounge
   * to the left edge and scrolled the working floor under them, which meant
   * two cameras, two clipped backdrop passes, and a seam down the middle of a
   * building that is supposed to read as one.
   */
  _cameraParams() {
    return {
      zoom: this._scale() / U,
      panX: this._camera.panX,
      panY: this._camera.panY,
      U,
    };
  }
}
