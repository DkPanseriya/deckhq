/**
 * The site's stills at their largest: the third file of a picture.
 *
 * A still has always been a pair, `name.png` and `name@2x.png`: the width a
 * page shows it at, and twice that. On a screen with more than two device
 * pixels to one, or one a reader has zoomed, twice is not enough, and the
 * widest pictures on the site stopped at 2400 pixels. So a picture that can be
 * drawn larger gets a third file, `name@3x`, up to 3840 pixels wide: a 4K
 * screen's worth.
 *
 * NEVER ENLARGED. The floor is drawn by the product at a real device pixel
 * ratio, and the ratio is chosen so the crop comes out at the width wanted:
 * 1600 CSS pixels at 2.4 is 3840. Four device pixels to one is the most a
 * capture is taken at, so a 468-pixel crop tops out at 1872; and a picture
 * that would gain less than a quarter over its `@2x` file gets no third file
 * at all. The pair is cut from the same capture, so the three are one picture.
 *
 * PNG, NOT WEBP, and that was measured (`site-assets.mjs --formats`, Chrome
 * 154's own encoder, 11 October 2026). The stills are 256-colour PNGs, and at
 * that look WebP is larger, not smaller:
 *
 *                              PNG 256   WebP lossless    WebP q90
 *                                        of those pixels  of the capture
 *   hero            3840x2400   350 KB       407 KB        306 KB
 *   office          1872x1616   165 KB       187 KB        116 KB
 *   walnut style    3840x2088   370 KB       383 KB        318 KB
 *
 * Lossy WebP at 0.9 is 13 to 30% lighter, and is a different picture: its
 * worst pixel is 47 to 77 levels from the capture, where the palette's is 20
 * to 22, which on flat colour and small text is ringing at every edge. Not
 * clearly smaller at the same look, so PNG. `encodeWebp` and `compareFormats`
 * stay, so the next person can measure it again instead of believing this.
 */
import fs from 'node:fs';

import { cropImage, encodePng } from './png.mjs';
import { encodeIndexedPng } from './png-indexed.mjs';

/** The widest a still is written: 3840, the width of a 4K screen. */
export const LARGE_WIDTH = 3840;

/** The most device pixels to one CSS pixel a capture is taken at. */
export const MAX_SCALE = 4;

/**
 * The width of a picture's largest file, or 0 when it has none.
 *
 * @param {{kind:string, width:number, single?:boolean, large?:boolean,
 *          crop?:{x:number,y:number,w:number,h:number}}} asset
 */
export function largeWidth(asset) {
  if (asset.kind !== 'still' || asset.single || asset.large === false || !asset.crop) return 0;
  const width = Math.min(LARGE_WIDTH, asset.crop.w * MAX_SCALE);
  return width >= asset.width * 1.25 ? width - (width % 2) : 0;
}

/**
 * The device pixel ratio a still is captured at: the one that makes its crop
 * exactly as wide as its largest file, and otherwise the whole ratio that
 * covers its `@2x` file.
 */
export function stillScale(asset) {
  const large = largeWidth(asset);
  if (large) return large / asset.crop.w;
  const dense = asset.crop ? Math.min(MAX_SCALE, Math.ceil(asset.width / asset.crop.w)) : 2;
  return Math.max(2, dense);
}

/**
 * Cut a crop given in CSS pixels out of a whole-window screenshot, in device
 * pixels. At a ratio that is not a whole number Chrome's own clip resamples
 * the picture; a cut on rounded device pixels moves an edge by less than one
 * of them and changes no pixel.
 *
 * @param {{width:number,height:number,data:Uint8Array}} shot the whole window
 * @param {{x:number,y:number,w:number,h:number}} crop
 * @param {number} scale
 */
export function cutCrop(shot, crop, scale) {
  const x = Math.round(crop.x * scale);
  const y = Math.round(crop.y * scale);
  return cropImage(shot, {
    x,
    y,
    w: Math.min(shot.width - x, Math.round(crop.w * scale)),
    h: Math.min(shot.height - y, Math.round(crop.h * scale)),
  });
}

/**
 * Encode a PNG as WebP with Chrome's own encoder, in the page the client is
 * on, and say how far the result is from the picture it was given.
 *
 * `quality` 1 is lossless in Chrome; `worst` is then 0 and that is checked by
 * decoding the WebP again, not assumed.
 *
 * @param {any} client a CDP client on a page in a secure context
 * @param {Uint8Array} png
 * @param {number} quality 0..1
 * @param {Uint8Array} [against] another PNG of the same size to measure the
 *   result against, when `png` is itself an approximation of it
 * @returns {Promise<{bytes:Buffer, mean:number, worst:number}>}
 */
export async function encodeWebp(client, png, quality, against) {
  const { result, exceptionDetails } = await client.send('Runtime.evaluate', {
    returnByValue: true,
    awaitPromise: true,
    expression: `(async () => {
      const bytes = Uint8Array.from(atob("${Buffer.from(png).toString('base64')}"), (c) => c.charCodeAt(0));
      const source = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const pixels = (bitmap) => {
        const c = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(bitmap, 0, 0);
        return { c, data: ctx.getImageData(0, 0, c.width, c.height).data };
      };
      const before = pixels(source);
      const blob = await before.c.convertToBlob({ type: 'image/webp', quality: ${Number(quality)} });
      if (blob.type !== 'image/webp') throw new Error('this Chrome wrote ' + blob.type);
      const after = pixels(await createImageBitmap(blob)).data;
      const truth = ${against ? `pixels(await createImageBitmap(new Blob([Uint8Array.from(atob("${Buffer.from(against).toString('base64')}"), (c) => c.charCodeAt(0))], { type: 'image/png' }))).data` : 'before.data'};
      let sum = 0;
      let worst = 0;
      for (let i = 0; i < after.length; i++) {
        const d = Math.abs(after[i] - truth[i]);
        sum += d;
        if (d > worst) worst = d;
      }
      const out = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < out.length; i += 0x8000) {
        s += String.fromCharCode.apply(null, out.subarray(i, i + 0x8000));
      }
      return { base64: btoa(s), mean: sum / after.length, worst };
    })()`,
  });
  if (exceptionDetails) {
    throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
  }
  const { base64, mean, worst } = result.value;
  return { bytes: Buffer.from(base64, 'base64'), mean, worst };
}

/**
 * The same picture in every format it could be written in, with what each
 * weighs and how far it is from the capture: the measurement the choice of
 * format rests on. Printed by `site-assets.mjs --formats`; writes nothing.
 *
 * @param {any} client
 * @param {{width:number,height:number,data:Uint8Array}} img the capture
 * @returns {Promise<string>} one line
 */
export async function compareFormats(client, img) {
  const truth = encodePng(img);
  const indexed = encodeIndexedPng(img);
  const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
  const off = (r) => `${r.mean.toFixed(2)}/255 mean, worst ${r.worst}`;
  const same = await encodeWebp(client, indexed, 1, truth);
  const exact = await encodeWebp(client, truth, 1);
  const q90 = await encodeWebp(client, truth, 0.9);
  const q80 = await encodeWebp(client, truth, 0.8);
  return (
    `${img.width}x${img.height}: PNG 256 colours ${kb(indexed.length)} (${off(same)}); ` +
    `WebP lossless of those 256 colours ${kb(same.bytes.length)}; ` +
    `PNG true colour ${kb(truth.length)}; WebP lossless true colour ${kb(exact.bytes.length)} ` +
    `(worst ${exact.worst}); WebP q90 ${kb(q90.bytes.length)} (${off(q90)}); ` +
    `WebP q80 ${kb(q80.bytes.length)} (${off(q80)})`
  );
}

/**
 * Write a still's largest file and say what was written.
 *
 * @param {any} client
 * @param {{width:number,height:number,data:Uint8Array}} img the capture
 * @param {string} base the file, without its extension: `…/hero@3x`
 */
export async function writeLarge(client, img, base) {
  const bytes = encodeIndexedPng(img);
  const file = `${base}.png`;
  fs.writeFileSync(file, bytes);
  return {
    file,
    width: img.width,
    height: img.height,
    bytes: bytes.length,
    said: `${(bytes.length / 1024).toFixed(0)} KB`,
  };
}
