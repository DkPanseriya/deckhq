/**
 * THE GROUND UNDER THE PEOPLE, composed once.
 *
 * Three things are painted before anybody is drawn: the ground's falloff — one
 * radial gradient across the whole canvas — the building's shadow, and the
 * floor's baked bitmap. None of them changes between one re-plan, resize or
 * camera move and the next, and all three were painted again on every frame.
 * Where the frame is rastered in software (no GPU, a remote desktop, a virtual
 * machine) those three were nine tenths of what a frame cost: a frame of the
 * 150-agent floor took 62 ms with them painted and 4 ms with them composed
 * (`scripts/render-bench.mjs`, headless, 2000 x 1055).
 *
 * So they are painted into one canvas the size of the floor's own, and a frame
 * puts that down with a single one-to-one `drawImage` under the identity
 * transform. It is the same three calls on a transparent surface, and copying a
 * surface onto a cleared one is exact: the layer and the direct paint are the
 * same pixels, which `scripts/render-bench.mjs` draws both ways and compares.
 *
 * WHEN IT IS COMPOSED. The layer is keyed on everything those three calls read
 * — the canvas and its pixel ratio, the camera, the two bitmaps in hand, the
 * three palette tokens. A key seen for the first time is painted DIRECTLY, and
 * the layer is composed on the next frame that asks for the same one: a wheel
 * zoom or a window drag changes the key on every frame, and composing a layer
 * for a picture that is about to be thrown away would be one more full-canvas
 * blit than painting it.
 *
 * The cross-fade of a re-plan is not in it. That is a second bitmap at a
 * changing alpha for 260 ms, drawn over this as it always was.
 *
 * One canvas of memory, the size of the visible one, held while there is a
 * floor; dropped on `destroy()`.
 */

import { U } from './plan.js';
import { PALETTE } from './palette.js';
import { setLightShadow, ENVELOPE_SHADOW_BLUR_PX, ENVELOPE_SHADOW_DIST_PX } from './backdrop.js';
import { setDeviceScale } from './device-px.js';
import { SceneHit } from './scene-hit.js';

/**
 * Everything the ground is a function of, as one string.
 *
 * Pure and exported, so a test can say which changes do and do not compose a
 * new layer. The two bitmaps are compared by identity beside it: a bake always
 * makes a new one.
 *
 * @param {{canvasW:number, canvasH:number, dpr:number, viewW:number, viewH:number,
 *   panX:number, panY:number, zoom:number, scale:number, planW:number, planH:number,
 *   wash:string, shadow:string, ground:string}} v
 * @returns {string}
 */
export function groundKey(v) {
  return [
    v.canvasW,
    v.canvasH,
    v.dpr,
    v.viewW,
    v.viewH,
    v.panX,
    v.panY,
    v.zoom,
    v.scale,
    v.planW,
    v.planH,
    v.wash,
    v.shadow,
    v.ground,
  ].join('|');
}

export class SceneStatic extends SceneHit {
  /**
   * The ground, the building's shadow and the floor, painted straight onto
   * `ctx`: what a frame did before there was a layer, and still what composes
   * the layer. `ctx` is at the pixel ratio's transform.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} viewW @param {number} viewH the canvas in CSS pixels
   * @param {{zoom:number, panX:number, panY:number}} camera
   */
  _paintGround(ctx, viewW, viewH, camera) {
    // The building sits ON a ground rather than being cut out of the
    // background. The floor takes the shape its contents want (see plan.js's
    // ASPECT_PAD_MAX), so on most windows there is slack on one axis; a soft
    // drop shadow under the envelope makes that slack read as "the floor
    // ends here" instead of as a gap in an unfinished plan.
    const shadowX = camera.panX;
    const shadowY = camera.panY;
    const shadowW = this._plan.width * U * camera.zoom;
    const shadowH = this._plan.height * U * camera.zoom;

    // THE GROUND FALLS AWAY FROM THE BUILDING (WP-72). One radial gradient,
    // transparent where the floor ends and `groundFalloff` at the furthest
    // corner of the window, painted BEFORE the envelope so the building and
    // its shadow land on top of it. It is what makes the ground a surface
    // the building is standing on rather than a backing colour it happens to
    // be cut out of. It cannot be baked with the floor — the bake IS the
    // envelope, and this is by definition the part outside it — so it is
    // composed with it instead, here.
    const wash = this._groundFalloff(viewW, viewH, shadowX, shadowY, shadowW, shadowH);
    if (wash) {
      ctx.save();
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, viewW, viewH);
      ctx.restore();
    }

    ctx.save();
    setLightShadow(ctx, {
      blur: ENVELOPE_SHADOW_BLUR_PX,
      dist: ENVELOPE_SHADOW_DIST_PX,
      color: PALETTE.floorDropShadow,
    });
    ctx.fillStyle = PALETTE.floorGround;
    ctx.fillRect(shadowX, shadowY, shadowW, shadowH);
    ctx.restore();

    // The floor's bitmap, one pixel to one device pixel (`_blitFloor`).
    this._blitFloor(ctx);
  }

  /**
   * Put the ground on the frame: the composed layer where there is one for
   * this exact picture, the direct paint otherwise.
   *
   * @param {CanvasRenderingContext2D} ctx the frame's, at the pixel ratio's transform
   * @param {number} viewW @param {number} viewH
   * @param {{zoom:number, panX:number, panY:number}} camera
   */
  _drawGround(ctx, viewW, viewH, camera) {
    if (!this._plan || !this._backdrop) return;
    const key = groundKey({
      canvasW: this.canvas.width,
      canvasH: this.canvas.height,
      dpr: this._dpr,
      viewW,
      viewH,
      panX: camera.panX,
      panY: camera.panY,
      zoom: camera.zoom,
      scale: this._scale(),
      planW: this._plan.width,
      planH: this._plan.height,
      wash: PALETTE.groundFalloff,
      shadow: PALETTE.floorDropShadow,
      ground: PALETTE.floorGround,
    });
    const seen = this._groundSeen;
    const same =
      !!seen &&
      seen.key === key &&
      seen.backdrop === this._backdrop &&
      seen.detail === this._detail;
    this._groundSeen = { key, backdrop: this._backdrop, detail: this._detail };
    const layer = this._groundLayer;
    if (same && layer && layer.fresh) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(layer.canvas, 0, 0);
      ctx.restore();
      return;
    }
    if (layer) layer.fresh = false;
    // The second frame in a row to ask for this picture: compose it, and use it.
    const made =
      same && this._useGroundLayer !== false ? this._composeGround(viewW, viewH, camera) : null;
    if (made) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(made, 0, 0);
      ctx.restore();
      return;
    }
    this._paintGround(ctx, viewW, viewH, camera);
  }

  /**
   * Paint the ground into the layer, making the layer's canvas where there is
   * none of this size. Null where a second canvas cannot be had; the frame then
   * paints directly, as it always did.
   *
   * @param {number} viewW @param {number} viewH
   * @param {{zoom:number, panX:number, panY:number}} camera
   * @returns {HTMLCanvasElement|null}
   */
  _composeGround(viewW, viewH, camera) {
    let layer = this._groundLayer;
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (!layer) {
      if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
        return null;
      }
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      layer = this._groundLayer = { canvas, ctx, fresh: false };
    }
    if (layer.canvas.width !== w) layer.canvas.width = w;
    if (layer.canvas.height !== h) layer.canvas.height = h;
    const ctx = layer.ctx;
    // The same two transforms the frame itself is cleared and painted under.
    setDeviceScale(ctx, this._dpr);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    this._paintGround(ctx, viewW, viewH, camera);
    layer.fresh = true;
    return layer.canvas;
  }

  /** Let the layer's canvas go: the next frame paints the ground directly. */
  _dropGroundLayer() {
    if (this._groundLayer) {
      // A canvas keeps its pixels until it is collected; a 1 x 1 one keeps none.
      this._groundLayer.canvas.width = 1;
      this._groundLayer.canvas.height = 1;
    }
    this._groundLayer = null;
    this._groundSeen = null;
  }
}
