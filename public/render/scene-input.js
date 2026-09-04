/**
 * Every listener the canvas owns, and the zoom API beside them
 * (WP-22 follow-up).
 *
 * Split out of `scene.js` unchanged. `_bind()` is still the one place the
 * scene subscribes to anything, and `destroy()` in `scene.js` still tears
 * down exactly what it put up. The four public zoom/pan entry points sit here
 * rather than with the camera because the wheel handler is their only caller
 * inside this file, and app.js's keyboard map is the only one outside it.
 *
 * A pointer is a read: `_onPointerUp` reports a selection to app.js and
 * writes nothing itself (docs/01-PRODUCT.md §2).
 */

import {
  clamp,
  computeTargetAspect,
  shouldRebuildAspect,
  RESIZE_DEBOUNCE_MS,
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_WHEEL_RATE,
  DEFAULT_VIEW_W,
  DEFAULT_VIEW_H,
} from './scene-camera.js';
import { bakeBackdrop } from './backdrop.js';
import { SceneDraw } from './scene-draw.js';

/** Pointer travel past which a press counts as a pan rather than a click. */
export const DRAG_SLOP_PX = 4;

export class SceneInput extends SceneDraw {
  /**
   * Set the magnification, keeping the world point under `anchor` (screen px,
   * defaulting to the centre of the stage) under it afterwards.
   *
   * Zoom is MAGNIFICATION ONLY: 1.0 is exactly the fit scale and is the
   * minimum, so there is no state in which the user can lose the floor by
   * zooming out past it (05-LAYOUT-REWORK.md §2.4). Detail is what zoom is
   * for — VISUAL-SPEC §1.1's L1 and L2 bands, and every clip in WP7, are only
   * visible above the fit scale on a floor with more than a few projects.
   * @param {number} next
   * @param {{x:number,y:number}} [anchor]
   */
  setZoom(next, anchor) {
    const target = clamp(Number(next) || 1, ZOOM_MIN, ZOOM_MAX);
    if (Math.abs(target - this._zoom) < 1e-4) return;
    const ax = anchor ? anchor.x : (this._viewW || 1) / 2;
    const ay = anchor ? anchor.y : (this._viewH || 1) / 2;
    const before = this._scale();
    const worldX = (ax - this._camera.panX) / before;
    const worldY = (ay - this._camera.panY) / before;
    this._zoom = target;
    const after = this._scale();
    this._camera.panX = ax - worldX * after;
    this._camera.panY = ay - worldY * after;
    this._clampCamera();
    if (!this._running) this._draw();
  }

  /** Current magnification, for a caller that wants to render a control. */
  get zoom() {
    return this._zoom;
  }

  /** Back to fit-to-window (VISUAL-SPEC §1: the `0` key). */
  resetZoom() {
    this._zoom = 1;
    this._centerCamera();
    if (!this._running) this._draw();
  }

  /** Step the magnification (the `+` / `-` keys). */
  zoomBy(factor) {
    this.setZoom(this._zoom * factor);
  }

  /** Pan by a screen-space delta, clamped to the floor. */
  panBy(dx, dy) {
    if (!this._pannable()) return;
    this._camera.panX += dx;
    this._camera.panY += dy;
    this._clampCamera();
    if (!this._running) this._draw();
  }

  // -------------------------------------------------------------- pointer

  _bind() {
    this._onWheel = this._onWheel.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerLeave = this._onPointerLeave.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onResize = this._onResize.bind(this);
    this._onVisibilityChange = this._onVisibilityChange.bind(this);
    this._onReducedMotionChange = this._onReducedMotionChange.bind(this);
    this._frame = this._frame.bind(this);

    // Hover and click-to-select only — there is no drag gesture to
    // distinguish a click from any more, so all three listen on the canvas
    // alone (pointermove no longer needs to track a drag past the canvas
    // edge, so unlike the old pan-era binding this does not need `window`).
    this.canvas.addEventListener('wheel', this._onWheel, { passive: false });
    this.canvas.addEventListener('pointerdown', this._onPointerDown);
    this.canvas.addEventListener('pointermove', this._onPointerMove);
    this.canvas.addEventListener('pointerleave', this._onPointerLeave);
    this.canvas.addEventListener('pointerup', this._onPointerUp);
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this._onResize);
    }
    // The canvas box changes without the window ever resizing — opening the
    // side panel is the common case. Left unobserved, the backing store keeps
    // its old size, the browser squeezes it into the narrower element, and
    // the previous frame's pixels stay on screen outside the cleared region.
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(this._onResize);
      this._resizeObserver.observe(this.canvas);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this._onVisibilityChange);
    }
    if (this._reducedMotionQuery) {
      if (this._reducedMotionQuery.addEventListener) {
        this._reducedMotionQuery.addEventListener('change', this._onReducedMotionChange);
      } else if (this._reducedMotionQuery.addListener) {
        this._reducedMotionQuery.addListener(this._onReducedMotionChange);
      }
    }
  }

  /** Hover only — there is no camera drag any more, so every move is a hover check. */
  /**
   * Scroll the working floor sideways, but only when it actually overflows.
   *
   * While everything fits there is nothing to scroll to, so the wheel is left
   * alone and the page behaves normally — the floor is not a scroll trap.
   */
  /**
   * `Ctrl`/`Cmd` + wheel magnifies about the cursor (VISUAL-SPEC §8); a plain
   * wheel pans, but only while the floor is actually bigger than the stage, so
   * a fitted floor is never a scroll trap.
   */
  _onWheel(e) {
    const rect = this.canvas.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * ZOOM_WHEEL_RATE);
      this.setZoom(this._zoom * factor, { x: e.clientX - rect.left, y: e.clientY - rect.top });
      return;
    }
    if (!this._pannable()) return;
    if (!e.deltaX && !e.deltaY) return;
    e.preventDefault();
    // Shift+wheel is the conventional horizontal pan on a mouse with one wheel.
    const dx = e.shiftKey ? -e.deltaY : -e.deltaX;
    const dy = e.shiftKey ? 0 : -e.deltaY;
    this.panBy(dx, dy);
  }

  _onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    if (!this._pannable()) return;
    this._dragPointer = e.pointerId ?? 0;
    this._dragFrom = { x: e.clientX, y: e.clientY };
    this._dragMoved = 0;
    if (this.canvas.setPointerCapture && e.pointerId != null) {
      this.canvas.setPointerCapture(e.pointerId);
    }
  }

  _onPointerMove(e) {
    if (this._dragFrom && (e.pointerId ?? 0) === this._dragPointer) {
      const dx = e.clientX - this._dragFrom.x;
      const dy = e.clientY - this._dragFrom.y;
      this._dragMoved += Math.hypot(dx, dy);
      this._dragFrom = { x: e.clientX, y: e.clientY };
      this.panBy(dx, dy);
      this.canvas.style.cursor = 'grabbing';
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hit = this._hitTest(x, y);
    const key = hit ? `${hit.kind}:${hit.id}` : null;
    const prevKey = this._hoveredTarget
      ? `${this._hoveredTarget.kind}:${this._hoveredTarget.id}`
      : null;
    if (key !== prevKey) {
      this._hoveredTarget = hit;
      this._onHover(hit);
    }
  }

  /** Clear hover when the pointer leaves the canvas — pointermove is scoped
   * to the canvas itself (see `_bind`), so nothing else would ever tell the
   * tooltip to go away once the cursor has moved off it. */
  _onPointerLeave() {
    this._dragFrom = null;
    this._dragPointer = null;
    if (this._hoveredTarget !== null) {
      this._hoveredTarget = null;
      this._onHover(null);
    }
  }

  /** Click-to-select a character or a room plate (VISUAL-SPEC §8). */
  _onPointerUp(e) {
    if (e.button !== undefined && e.button !== 0) return;
    const dragged = this._dragMoved > DRAG_SLOP_PX;
    if (this._dragFrom) {
      this._dragFrom = null;
      this._dragPointer = null;
      this._dragMoved = 0;
      this.canvas.style.cursor = this._pannable() ? 'grab' : '';
      // A drag is a camera move, not a selection. Without this, panning the
      // floor selects whatever happened to be under the finger when it lifted.
      if (dragged) return;
    }
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hit = this._hitTest(x, y);
    if (hit) this._onSelect(hit);
  }

  _onResize() {
    this._resizeCanvasBacking();
    // Cheap on every resize event, however many fire during a window drag:
    // recompute the fit basis for the new box. A user sitting at zoom 1.0
    // stays exactly fitted (05-LAYOUT-REWORK.md §2.4); a zoomed-in user keeps
    // their magnification and has their pan re-clamped to the new stage.
    this._recomputeFitScale();
    if (this._zoom <= ZOOM_MIN + 1e-6) this._centerCamera();
    else this._clampCamera();
    this.canvas.style.cursor = this._pannable() ? 'grab' : '';
    if (!this._running) this._draw();
    // The expensive part — re-baking the backdrop for a new room layout — is
    // debounced separately; see `_scheduleAspectRecheck`.
    this._scheduleAspectRecheck();
  }

  /**
   * Debounce the resize-driven plan rebuild by 150ms (CONTRACTS-WP13.md
   * "Rebuild policy") so a window drag re-bakes the backdrop (~190ms for 12
   * projects) at most once, after the drag settles, rather than once per
   * pixel.
   */
  _scheduleAspectRecheck() {
    if (this._resizeDebounceTimer != null) clearTimeout(this._resizeDebounceTimer);
    this._resizeDebounceTimer = setTimeout(() => {
      this._resizeDebounceTimer = null;
      this._checkAspectRebuild();
    }, RESIZE_DEBOUNCE_MS);
  }

  /** Rebuild the plan only if the settled aspect drifted past the 0.02 tolerance. */
  _checkAspectRebuild() {
    if (!this._plan) return;
    const target = computeTargetAspect(this._viewW, this._viewH);
    if (!shouldRebuildAspect(target, this._plan.targetAspect)) return;
    this._rebuildPlan(target);
    if (!this._running) this._draw();
  }

  _resizeCanvasBacking() {
    const rect = this.canvas.getBoundingClientRect();
    const previousDpr = this._dpr;
    this._dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    // The backdrop is baked once, at the device pixel ratio it was baked for.
    // Drag the window to a display with a different one and it stays at the
    // old resolution — soft on the sharper screen, oversized on the other.
    if (this._plan && previousDpr && this._dpr !== previousDpr) {
      this._backdrop = bakeBackdrop(this._plan, this._dpr);
    }
    const w = Math.max(1, Math.round((rect.width || this._viewW || DEFAULT_VIEW_W) * this._dpr));
    const h = Math.max(1, Math.round((rect.height || this._viewH || DEFAULT_VIEW_H) * this._dpr));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  _onVisibilityChange() {
    if (typeof document === 'undefined') return;
    if (document.visibilityState === 'hidden') {
      this._stopLoop();
    } else if (this._wantRunning) {
      this._startLoop();
    }
  }

  _onReducedMotionChange(e) {
    this._reduced = !!e.matches;
    if (!this._running) this._draw();
  }
}
