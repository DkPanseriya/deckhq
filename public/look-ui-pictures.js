/**
 * THE CANVASES THE LOOK SECTION HANGS ON THE PAGE — WP-88b.
 *
 * `look-ui-thumbs.js` is the painting and has no DOM in it, so `node --test` can
 * count what it draws. This is the other half: one `<canvas>` per picture, the
 * cache that keeps a thumbnail from being repainted on every keystroke, and the
 * device-pixel scaling that keeps a 160 px floor from looking like a JPEG.
 *
 * ## The cache, and why the key is what it is
 *
 * §4 asks for thumbnails *"rendered on demand and cached per (preset, theme)"*.
 * A swatch needs more than that — a floor chip is painted through the CURRENT
 * scheme, so `oak` under `clay` and `oak` under `mono` are two pictures — so the
 * caller composes a key that names everything the picture depends on and this
 * file never guesses at one. The theme is added here, because it is the one
 * thing every picture depends on and the one thing no caller should have to
 * remember.
 *
 * Bounded: `MAX_PICTURES` entries, oldest evicted first. A settings sheet left
 * open while somebody walks every option with the arrow keys would otherwise
 * hold one canvas per combination they crossed.
 */

import {
  PREVIEW_U,
  SWATCH_H,
  SWATCH_U,
  SWATCH_W,
  THUMB_H,
  THUMB_U,
  THUMB_W,
  paintLookFragment,
  paintLookSwatch,
  paintLookThumbnail,
  withLook,
} from './look-ui-thumbs.js';

/**
 * The live preview, in logical pixels. §4's *"~9 px/U"*, which makes this a
 * seventy-unit fragment: wide enough that a floor material lays several
 * repeats of its own pattern rather than one, which is the difference between
 * a preview and a colour chip.
 */
export const PREVIEW_W = 640;
export const PREVIEW_H = 104;

/**
 * How many painted canvases are kept. Six thumbnails, thirty-six swatches and a
 * preview is forty-three on one theme; this is room for three themes and a walk
 * through every scheme, and a ceiling on a sheet nobody closes.
 */
export const MAX_PICTURES = 240;

/**
 * The backing store is at least twice the logical size.
 *
 * A floor material is hairlines — a 0.16 seam, a 0.8 px grout line — and at one
 * device pixel per logical pixel a 160 px herringbone is a smear. Two is the
 * floor rather than the ceiling: a retina screen reports 2 or 3 and gets it, and
 * a 1x screen still gets a supersampled picture that the browser scales down,
 * which is the one direction resampling flatters.
 */
export const MIN_PICTURE_SCALE = 2;

/**
 * @param {object} deps
 * @param {any} deps.doc        `document`
 * @param {() => string} deps.theme  the theme the floor is painted in
 * @param {() => number} [deps.dpr]
 */
export function createLookPictures(deps) {
  const { doc, theme } = deps;
  const dpr = deps.dpr || (() => (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1));
  /** @type {Map<string, any>} */
  const cache = new Map();

  /**
   * A canvas of `w` x `h` logical pixels, painted by `paint`, or `null` where
   * this browser has no 2D context to give. Never throws: a settings section
   * that fell over because a canvas was refused would take the whole sheet with
   * it, and the section is a working set of controls without its pictures.
   *
   * @param {number} w @param {number} h @param {(ctx:any) => void} paint
   */
  function canvasOf(w, h, paint) {
    try {
      const scale = Math.max(MIN_PICTURE_SCALE, dpr() || 1);
      const canvas = doc.createElement('canvas');
      canvas.width = Math.ceil(w * scale);
      canvas.height = Math.ceil(h * scale);
      // The CSS size is the STYLESHEET's, deliberately: an inline `style.width`
      // outranks every rule in `style.css`, so setting one here would pin a
      // preset card's picture at 160 px inside a card that is 210 px wide and
      // leave a gap nobody could close from CSS. The backing store above is the
      // only thing this file decides, and `height: auto` on a canvas follows its
      // intrinsic ratio, so the aspect is carried by the numbers rather than by
      // a second declaration that could disagree with them.
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.scale(scale, scale);
      paint(ctx);
      return canvas;
    } catch (err) {
      console.debug('[deckhq] a look picture could not be painted', err);
      return null;
    }
  }

  /** @param {string} key @param {() => any} build */
  function cached(key, build) {
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const made = build();
    cache.set(key, made);
    if (cache.size > MAX_PICTURES) cache.delete(cache.keys().next().value);
    return made;
  }

  /**
   * One picture for the section. `spec.kind` says which.
   *
   * @param {{kind:string, look:any, key:string, zone?:string, rug?:string|null}} spec
   * @returns {any|null}
   */
  function picture(spec) {
    const name = theme();
    const key = `${spec.kind}|${spec.key}|${name}`;
    if (spec.kind === 'thumbnail') {
      return cached(key, () =>
        canvasOf(THUMB_W, THUMB_H, (ctx) =>
          paintLookThumbnail(ctx, { look: spec.look, theme: name, w: THUMB_W, h: THUMB_H }),
        ),
      );
    }
    if (spec.kind === 'swatch') {
      return cached(key, () =>
        canvasOf(SWATCH_W, SWATCH_H, (ctx) =>
          paintLookSwatch(ctx, {
            look: spec.look,
            theme: name,
            zone: spec.zone || 'office',
            rug: spec.rug || null,
            w: SWATCH_W,
            h: SWATCH_H,
            u: SWATCH_U,
          }),
        ),
      );
    }
    if (spec.kind !== 'preview') return null;
    // THE PREVIEW IS NEVER CACHED. It is the one picture that is the answer to
    // "what did that change do", and a cache hit on it would be the section
    // showing the floor the user just left. It is also the cheapest of the three
    // to repaint, because the look it shows is already the live one.
    return canvasOf(PREVIEW_W, PREVIEW_H, (ctx) =>
      withLook(spec.look, name, () =>
        paintLookFragment(ctx, { w: PREVIEW_W, h: PREVIEW_H, u: PREVIEW_U }),
      ),
    );
  }

  return { picture, size: () => cache.size, clear: () => cache.clear() };
}

export { THUMB_W, THUMB_H, SWATCH_W, SWATCH_H, PREVIEW_U, THUMB_U, SWATCH_U };
