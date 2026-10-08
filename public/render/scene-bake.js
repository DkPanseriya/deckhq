/**
 * The floor's bitmap: what scale it is baked at, when, and how it reaches the
 * screen.
 *
 * The floor is drawn once into a bitmap and blitted every frame. For that to be
 * sharp the bitmap has to be baked at exactly the scale it is drawn at, in
 * device pixels, and put down on a whole device pixel — otherwise every wall,
 * seam and shadow in it is resampled on its way to the screen while the figures
 * standing on it, which are vectors, are not. So:
 *
 *   - the bake is at `scale × devicePixelRatio`, and the blit is `drawImage` at
 *     an integer offset under the identity transform: one bitmap pixel, one
 *     device pixel;
 *   - the fit scale is moved by a fraction of a per cent so the floor is a whole
 *     number of device pixels wide, and the pan is on the device grid;
 *   - a bake costs tens to hundreds of milliseconds, so the scale has to hold
 *     still for `BAKE_SETTLE_MS` before it is baked again. While a zoom or a
 *     window drag is in flight the bitmap in hand is stretched, which is cheap
 *     and soft and lasts a moment.
 *
 * TWO BITMAPS, AT MOST. `_backdrop` is the whole floor at the fit scale; it is
 * what an unmagnified floor shows and what the mini-floor crops. `_detail`
 * exists only while the floor is magnified: the same drawing at the magnified
 * scale. A magnified floor can be many times the window, so past
 * `DETAIL_MAX_CANVASES` the detail is a window onto the floor — what is visible
 * and a margin round it — and it is baked again when a pan settles outside it.
 * The whole-floor bitmap stays underneath, so panning past the margin shows a
 * soft floor for a moment and never an empty one.
 *
 * The three functions at the top are pure and are what
 * `test/unit/scene-math.test.mjs` exercises, with `snapScaleToDevice` and
 * `snapToDevice` in `scene-camera.js`; the class needs a canvas.
 */

import { bakeBackdrop } from './backdrop.js';
import { SceneCamera } from './scene-camera.js';

/** How long the floor's scale holds still before it is baked again. */
export const BAKE_SETTLE_MS = 150;

/**
 * The most a magnified bake may be, in canvases. A whole floor that fits under
 * it is baked whole; past it only the visible window is.
 */
export const DETAIL_MAX_CANVASES = 2;

/**
 * How far past the window a windowed bake reaches, per side, as a fraction of
 * the window: 25 % more on each axis, 1.56 canvases in all.
 */
export const DETAIL_MARGIN = 0.125;

/** @param {number} a @param {number} b */
export function sameScale(a, b) {
  return Math.abs(a - b) <= 1e-6 * Math.max(Math.abs(a), Math.abs(b), 1);
}

/**
 * Which part of a magnified floor to bake: `null` for all of it, or the visible
 * window and its margin, in device pixels of the floor at `ppu`.
 *
 * @param {{planW:number, planH:number, ppu:number, originX:number, originY:number,
 *   canvasW:number, canvasH:number}} v `origin` is where the floor's corner is
 *   on the canvas, in device pixels
 * @returns {{x:number, y:number, w:number, h:number}|null}
 */
export function detailRegion(v) {
  const fullW = v.planW * v.ppu;
  const fullH = v.planH * v.ppu;
  if (fullW * fullH <= DETAIL_MAX_CANVASES * v.canvasW * v.canvasH) return null;
  const mx = v.canvasW * DETAIL_MARGIN;
  const my = v.canvasH * DETAIL_MARGIN;
  const x = Math.max(0, Math.floor(-v.originX - mx));
  const y = Math.max(0, Math.floor(-v.originY - my));
  const x1 = Math.min(Math.ceil(fullW), Math.ceil(-v.originX + v.canvasW + mx));
  const y1 = Math.min(Math.ceil(fullH), Math.ceil(-v.originY + v.canvasH + my));
  if (x1 <= x || y1 <= y) return null;
  return { x, y, w: x1 - x, h: y1 - y };
}

/**
 * Does a bitmap at `(x, y)` of the floor cover everything of the floor that is
 * on the canvas? All in device pixels at the bitmap's own scale.
 * @param {{x:number, y:number, w:number, h:number}} bitmap
 * @param {{fullW:number, fullH:number, originX:number, originY:number,
 *   canvasW:number, canvasH:number}} v
 */
export function coversView(bitmap, v) {
  const x0 = Math.max(0, -v.originX);
  const y0 = Math.max(0, -v.originY);
  const x1 = Math.min(v.fullW, -v.originX + v.canvasW);
  const y1 = Math.min(v.fullH, -v.originY + v.canvasH);
  if (x1 <= x0 || y1 <= y0) return true;
  return (
    bitmap.x <= x0 + 0.5 &&
    bitmap.y <= y0 + 0.5 &&
    bitmap.x + bitmap.w >= x1 - 0.5 &&
    bitmap.y + bitmap.h >= y1 - 0.5
  );
}

export class SceneBake extends SceneCamera {
  /** Device pixels per unit the unmagnified floor is drawn at. */
  _fitPpu() {
    return this._fitScale * this._dpr;
  }

  /** Where the floor's corner is on the canvas, and how big the canvas is, in device pixels. */
  _deviceView() {
    const cam = this._cameraParams();
    return {
      originX: Math.round(cam.panX * this._dpr),
      originY: Math.round(cam.panY * this._dpr),
      canvasW: this.canvas.width,
      canvasH: this.canvas.height,
    };
  }

  /**
   * Bake the whole floor at the fit scale, now. A new plan and a new paint
   * both come here; a magnified floor gets its detail back once it settles.
   */
  _bakeFloor() {
    if (!this._plan) return;
    const ppu = this._fitPpu();
    this._backdrop = { ...bakeBackdrop(this._plan, ppu), asked: ppu };
    this._detail = null;
    if (!sameScale(this._scale() * this._dpr, ppu)) this._scheduleBake();
  }

  /** Ask for the bitmaps to be brought up to the current scale once it holds still. */
  _scheduleBake() {
    if (this._bakeTimer != null) clearTimeout(this._bakeTimer);
    this._bakeTimer = setTimeout(() => {
      this._bakeTimer = null;
      if (this._settleBake() && !this._running) this._draw();
    }, BAKE_SETTLE_MS);
  }

  /**
   * Bring both bitmaps up to the scale the floor is at. Bakes only what is
   * stale, so calling it when nothing moved costs a comparison.
   * @returns {boolean} whether anything was baked or dropped
   */
  _settleBake() {
    if (!this._plan || !this._backdrop) return false;
    let changed = false;
    const fit = this._fitPpu();
    if (!sameScale(this._backdrop.asked, fit)) {
      this._backdrop = { ...bakeBackdrop(this._plan, fit), asked: fit };
      changed = true;
    }
    const want = this._scale() * this._dpr;
    if (sameScale(want, fit)) {
      if (this._detail) {
        this._detail = null;
        changed = true;
      }
      return changed;
    }
    const view = this._deviceView();
    const detail = this._detail;
    const fresh =
      detail &&
      sameScale(detail.asked, want) &&
      (!detail.windowed ||
        coversView(
          { x: detail.x, y: detail.y, w: detail.canvas.width, h: detail.canvas.height },
          {
            ...view,
            fullW: this._plan.width * detail.ppu,
            fullH: this._plan.height * detail.ppu,
          },
        ));
    if (fresh) return changed;
    const region = detailRegion({
      ...view,
      planW: this._plan.width,
      planH: this._plan.height,
      ppu: want,
    });
    const baked = bakeBackdrop(this._plan, want, { region });
    // A bake past the pixel ceiling comes back whole and at a lower scale.
    this._detail = { ...baked, asked: want, windowed: !!region && sameScale(baked.ppu, want) };
    return true;
  }

  /**
   * Put the floor on the canvas. Under the identity transform, so a bitmap at
   * the drawn scale goes down one pixel to one pixel; one at any other scale —
   * a zoom in flight, a window being dragged — is stretched to fit.
   * @param {CanvasRenderingContext2D} ctx
   */
  _blitFloor(ctx) {
    const base = this._backdrop;
    if (!base || !this._plan) return;
    const want = this._scale() * this._dpr;
    const view = this._deviceView();
    const put = (/** @type {any} */ b) => {
      const r = want / b.ppu;
      if (Math.abs(r - 1) < 1e-6) {
        ctx.drawImage(b.canvas, view.originX + b.x, view.originY + b.y);
      } else {
        ctx.drawImage(
          b.canvas,
          view.originX + b.x * r,
          view.originY + b.y * r,
          b.canvas.width * r,
          b.canvas.height * r,
        );
      }
    };
    const detail = this._detail;
    const exact =
      detail &&
      Math.abs(want / detail.ppu - 1) < 1e-6 &&
      coversView(
        { x: detail.x, y: detail.y, w: detail.canvas.width, h: detail.canvas.height },
        { ...view, fullW: this._plan.width * want, fullH: this._plan.height * want },
      );
    const baseExact = Math.abs(want / base.ppu - 1) < 1e-6;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // The whole floor first, unless the detail hides every pixel of it. And a
    // detail left over from a magnification that has just been reset is not
    // drawn over a floor that is already one to one.
    if (!exact) put(base);
    if (detail && (exact || !baseExact)) put(detail);
    ctx.restore();
  }
}
