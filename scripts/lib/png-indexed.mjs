/**
 * A palette PNG, for the pictures the site serves.
 *
 * The floor is a drawing: flat fills, line work and a few hundred distinct
 * colours. Written as 8-bit truecolour it pays four bytes for every pixel of a
 * carpet that is one colour; written against a palette of 256 it pays one, and
 * the deflate stream behind it is a third of the size. That is the whole
 * reason this file exists: a sharp picture at twice its displayed size that
 * still arrives quickly.
 *
 * The palette is the GIF encoder's own median cut (`scripts/gif-encoder.mjs`),
 * which splits on the widest colour range rather than on population, so a
 * crimson badge of a few hundred pixels keeps its own entry instead of being
 * averaged into the green around it.
 *
 * `scripts/lib/png.mjs` deliberately does not read this shape back (the
 * goldens gate compares truecolour only), so `pngSize()` below reads the two
 * numbers a page needs straight out of the header.
 *
 * Dev tooling only: nothing under `scripts/` is in the published package.
 */
import zlib from 'node:zlib';

import { buildPalette, indexPixels, Q } from '../gif-encoder.mjs';
import { crc32 } from './png.mjs';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** @param {string} type @param {Buffer} body */
function chunk(type, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

/**
 * Encode an opaque RGBA image as an 8-bit palette PNG.
 *
 * Alpha is dropped: every picture this writes is a screenshot of an opaque
 * page. The scanline filter is `None`, which is the right one for indices: a
 * difference between two palette slots means nothing, and a run of the same
 * slot is already what deflate is best at.
 *
 * `dither` spreads each pixel's rounding error onto its neighbours (Floyd and
 * Steinberg's weights). A drawing does not want it: its flats would turn to
 * noise. A shaded render does, or its gradients come out in bands.
 *
 * @param {{width:number, height:number, data:Uint8Array}} img
 * @param {number} [colours] palette size, at most 256
 * @param {{dither?: boolean}} [opts]
 * @returns {Buffer}
 */
export function encodeIndexedPng(img, colours = 256, opts = {}) {
  const { width, height, data } = img;
  if (data.length !== width * height * 4) {
    throw new Error(`image data is ${data.length} bytes, expected ${width * height * 4}`);
  }
  const palette = buildPalette([data], Math.min(256, colours));
  const cache = new Int16Array(1 << (3 * Q)).fill(-1);
  const indices = opts.dither ? ditherPixels(img, palette) : indexPixels(data, palette, cache);

  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0;
    raw.set(indices.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // palette
  const plte = Buffer.alloc(palette.length * 3);
  palette.forEach((c, i) => plte.set(c, i * 3));

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('PLTE', plte),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Index an image against a palette with error diffusion.
 *
 * @param {{width:number, height:number, data:Uint8Array}} img
 * @param {number[][]} palette
 * @returns {Uint8Array} one palette index per pixel
 */
function ditherPixels({ width, height, data }, palette) {
  const cache = new Int16Array(1 << 18).fill(-1);
  const nearest = (r, g, b) => {
    const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
    if (cache[key] >= 0) return cache[key];
    let best = 0;
    let bestD = Infinity;
    for (let p = 0; p < palette.length; p++) {
      const d = (r - palette[p][0]) ** 2 + (g - palette[p][1]) ** 2 + (b - palette[p][2]) ** 2;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    cache[key] = best;
    return best;
  };
  const rgb = new Float32Array(width * height * 3);
  for (let i = 0, o = 0; i < data.length; i += 4, o += 3) {
    rgb[o] = data[i];
    rgb[o + 1] = data[i + 1];
    rgb[o + 2] = data[i + 2];
  }
  const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
  const out = new Uint8Array(width * height);
  // Where the error goes, and how much of it: right, down-left, down, down-right.
  const spread = [
    [1, 0, 7 / 16],
    [-1, 1, 3 / 16],
    [0, 1, 5 / 16],
    [1, 1, 1 / 16],
  ];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 3;
      const r = clamp(rgb[o]);
      const g = clamp(rgb[o + 1]);
      const b = clamp(rgb[o + 2]);
      const p = nearest(r, g, b);
      out[y * width + x] = p;
      const error = [r - palette[p][0], g - palette[p][1], b - palette[p][2]];
      for (const [dx, dy, weight] of spread) {
        const nx = x + dx;
        if (nx < 0 || nx >= width || y + dy >= height) continue;
        const n = ((y + dy) * width + nx) * 3;
        for (let c = 0; c < 3; c++) rgb[n + c] += error[c] * weight;
      }
    }
  }
  return out;
}

/**
 * The pixel size of any PNG, read from its header and nothing else.
 *
 * @param {Uint8Array} bytes
 * @returns {{width:number, height:number} | null}
 */
export function pngSize(bytes) {
  if (bytes.length < 24 || !Buffer.from(bytes.subarray(0, 8)).equals(SIGNATURE)) return null;
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.readUInt32BE(16), height: view.readUInt32BE(20) };
}
