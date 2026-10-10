/**
 * What a picture's box shows before the picture arrives.
 *
 * Every picture below the first is lazy, and a lazy picture is an empty box
 * until the reader scrolls near it. The box already has the picture's own
 * width and height; this gives it the picture's own colour, near enough: the
 * build reads each capture, takes the mean of its pixels, and names the
 * closest of the few placeholder tones the stylesheet defines (`--ph-*`).
 * A floor arrives into a box the colour of a floor, and a dark panel into a
 * dark one.
 *
 * A class and not an inline style, because no page here carries one; a few
 * tones and not a colour per picture, because the stylesheet has a budget.
 * Nothing is fetched and no dependency is used: a PNG is inflated with
 * `node:zlib` and its scanlines are unfiltered here.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';

/** Samples per row and rows skipped: a mean does not need every pixel. */
const STEP = 6;

/**
 * The mean colour of a PNG, or null for a file this cannot read. Handles what
 * the captures are (8-bit palette) and what the composed pictures might be
 * (8-bit grey, RGB and RGBA), not interlaced.
 *
 * @param {Buffer} bytes
 * @returns {[number, number, number] | null}
 */
export function meanColour(bytes) {
  if (bytes.length < 33 || bytes.readUInt32BE(0) !== 0x89504e47) return null;
  let ihdr = null;
  let plte = null;
  const idat = [];
  for (let at = 8; at + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString('latin1', at + 4, at + 8);
    const data = bytes.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') ihdr = data;
    else if (type === 'PLTE') plte = data;
    else if (type === 'IDAT') idat.push(data);
    at += 12 + length;
  }
  if (!ihdr || ihdr[8] !== 8 || ihdr[12] !== 0) return null;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const channels = { 0: 1, 2: 3, 3: 1, 6: 4 }[ihdr[9]];
  if (!channels || (ihdr[9] === 3 && !plte)) return null;

  const stride = width * channels;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  if (raw.length < (stride + 1) * height) return null;
  const sum = [0, 0, 0];
  let count = 0;
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? row[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let add = 0;
      if (filter === 1) add = a;
      else if (filter === 2) add = b;
      else if (filter === 3) add = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[x] = (row[x] + add) & 255;
    }
    prev = row;
    if (y % STEP) continue;
    for (let x = 0; x < width; x += STEP) {
      const i = x * channels;
      const at = ihdr[9] === 3 ? row[i] * 3 : i;
      const from = ihdr[9] === 3 ? plte : row;
      const grey = ihdr[9] === 0;
      sum[0] += from[at];
      sum[1] += from[grey ? at : at + 1];
      sum[2] += from[grey ? at : at + 2];
      count++;
    }
  }
  return count ? [sum[0] / count, sum[1] / count, sum[2] / count] : null;
}

/**
 * The placeholder tones the stylesheet defines: `--ph-oak: #d6c3a4;` gives
 * `{ oak: [214, 195, 164] }`. Read from the CSS so the two cannot disagree.
 *
 * @param {string} css
 * @returns {Record<string, [number, number, number]>}
 */
export function placeholderTones(css) {
  /** @type {Record<string, [number, number, number]>} */
  const tones = {};
  for (const m of css.matchAll(/--ph-([a-z]+):\s*#([0-9a-f]{6})\b/gi)) {
    tones[m[1]] = [0, 2, 4].map((i) => parseInt(m[2].slice(i, i + 2), 16));
  }
  return tones;
}

/**
 * The tone closest to a picture, by name, or null when the picture cannot be
 * read or there are no tones.
 *
 * @param {string} file a PNG
 * @param {Record<string, [number, number, number]>} tones
 */
export function placeholderFor(file, tones) {
  let mean = null;
  try {
    mean = meanColour(fs.readFileSync(file));
  } catch {
    return null;
  }
  if (!mean) return null;
  let best = null;
  let least = Infinity;
  for (const [name, tone] of Object.entries(tones)) {
    const d = (tone[0] - mean[0]) ** 2 + (tone[1] - mean[1]) ** 2 + (tone[2] - mean[2]) ** 2;
    if (d < least) [best, least] = [name, d];
  }
  return best;
}
