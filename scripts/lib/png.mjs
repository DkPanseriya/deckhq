/**
 * Just enough PNG to diff two screenshots, with nothing but `node:zlib`.
 *
 * The goldens harness needs to turn Chrome's screenshot into pixels, compare
 * it with a committed golden, and write a picture of where they disagree. A
 * PNG library would do that in one line and cost a dev dependency with its own
 * native build story; PNG's actual surface for 8-bit, non-interlaced images is
 * a chunk walk, one `inflate`, and five scanline filters, so it is written out
 * here instead. Palette, 16-bit and interlaced images are refused with a
 * message — Chrome never produces them and the goldens never contain them.
 *
 * @typedef {{width:number, height:number, data:Uint8Array}} Image  RGBA, row-major
 */
import zlib from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Bytes per pixel for the colour types we accept, all at bit depth 8. */
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

// ------------------------------------------------------------------ decode

/**
 * @param {Buffer|Uint8Array} bytes
 * @returns {Image}
 */
export function decodePng(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error('not a PNG: bad signature');
  }

  let width = 0;
  let height = 0;
  let colorType = -1;
  const idat = [];
  let pos = 8;
  let sawEnd = false;
  while (pos + 8 <= buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const start = pos + 8;
    const end = start + length;
    if (end + 4 > buf.length) throw new Error(`truncated PNG in ${type} chunk`);
    if (type === 'IHDR') {
      width = buf.readUInt32BE(start);
      height = buf.readUInt32BE(start + 4);
      const bitDepth = buf[start + 8];
      colorType = buf[start + 9];
      const interlace = buf[start + 12];
      if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth} (need 8)`);
      if (!(colorType in CHANNELS)) {
        throw new Error(`unsupported PNG colour type ${colorType} (palette images are not)`);
      }
      if (interlace !== 0) throw new Error('unsupported PNG: interlaced');
    } else if (type === 'IDAT') {
      idat.push(buf.subarray(start, end));
    } else if (type === 'IEND') {
      sawEnd = true;
      break;
    }
    pos = end + 4; // skip the CRC; a corrupt file fails in inflate or on length
  }
  if (!sawEnd) throw new Error('truncated PNG: no IEND');
  if (!width || !height) throw new Error('PNG has no IHDR');

  const channels = CHANNELS[colorType];
  const stride = width * channels;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  if (raw.length !== (stride + 1) * height) {
    throw new Error(`PNG data is ${raw.length} bytes, expected ${(stride + 1) * height}`);
  }

  // Undo the per-scanline filter in place, then expand to RGBA.
  const lines = new Uint8Array(stride * height);
  let prev = new Uint8Array(stride); // the line above the first is all zeros
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const line = lines.subarray(y * stride, (y + 1) * stride);
    unfilter(filter, src, prev, line, channels);
    prev = line;
  }

  const data = new Uint8Array(width * height * 4);
  for (let i = 0, o = 0; i < lines.length; i += channels, o += 4) {
    if (channels === 4) {
      data[o] = lines[i];
      data[o + 1] = lines[i + 1];
      data[o + 2] = lines[i + 2];
      data[o + 3] = lines[i + 3];
    } else if (channels === 3) {
      data[o] = lines[i];
      data[o + 1] = lines[i + 1];
      data[o + 2] = lines[i + 2];
      data[o + 3] = 255;
    } else {
      data[o] = data[o + 1] = data[o + 2] = lines[i];
      data[o + 3] = channels === 2 ? lines[i + 1] : 255;
    }
  }
  return { width, height, data };
}

/**
 * The five PNG scanline filters, reversed. `a` is the byte to the left, `b`
 * the byte above, `c` the byte above-left; each "byte" is `bpp` bytes back.
 * @param {number} filter
 * @param {Uint8Array} src   filtered bytes for this line
 * @param {Uint8Array} prev  reconstructed bytes of the line above
 * @param {Uint8Array} out   reconstructed bytes for this line (written)
 * @param {number} bpp
 */
function unfilter(filter, src, prev, out, bpp) {
  const n = src.length;
  switch (filter) {
    case 0:
      out.set(src);
      return;
    case 1:
      for (let i = 0; i < n; i++) out[i] = (src[i] + (i >= bpp ? out[i - bpp] : 0)) & 0xff;
      return;
    case 2:
      for (let i = 0; i < n; i++) out[i] = (src[i] + prev[i]) & 0xff;
      return;
    case 3:
      for (let i = 0; i < n; i++) {
        const a = i >= bpp ? out[i - bpp] : 0;
        out[i] = (src[i] + ((a + prev[i]) >> 1)) & 0xff;
      }
      return;
    case 4:
      for (let i = 0; i < n; i++) {
        const a = i >= bpp ? out[i - bpp] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;
        out[i] = (src[i] + paeth(a, b, c)) & 0xff;
      }
      return;
    default:
      throw new Error(`bad PNG filter type ${filter}`);
  }
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

// ------------------------------------------------------------------ encode

/**
 * Encode an RGBA image as an 8-bit truecolour-with-alpha PNG.
 *
 * `filter` picks the scanline filter applied to every row. The diff images
 * this writes are mostly flat colour, where `Sub` (1) compresses well; the
 * option is also what lets the decoder's five filter paths be tested without
 * a second encoder.
 * @param {Image} img
 * @param {{filter?: 0|1|2|3|4}} [opts]
 * @returns {Buffer}
 */
export function encodePng(img, opts = {}) {
  const { width, height, data } = img;
  const filter = opts.filter ?? 1;
  if (data.length !== width * height * 4) {
    throw new Error(`image data is ${data.length} bytes, expected ${width * height * 4}`);
  }
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  const zero = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const line = data.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? data.subarray((y - 1) * stride, y * stride) : zero;
    raw[y * (stride + 1)] = filter;
    applyFilter(filter, line, prev, raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The forward direction of `unfilter`, for the encoder. */
function applyFilter(filter, line, prev, out, bpp) {
  const n = line.length;
  switch (filter) {
    case 0:
      out.set(line);
      return;
    case 1:
      for (let i = 0; i < n; i++) out[i] = (line[i] - (i >= bpp ? line[i - bpp] : 0)) & 0xff;
      return;
    case 2:
      for (let i = 0; i < n; i++) out[i] = (line[i] - prev[i]) & 0xff;
      return;
    case 3:
      for (let i = 0; i < n; i++) {
        const a = i >= bpp ? line[i - bpp] : 0;
        out[i] = (line[i] - ((a + prev[i]) >> 1)) & 0xff;
      }
      return;
    case 4:
      for (let i = 0; i < n; i++) {
        const a = i >= bpp ? line[i - bpp] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;
        out[i] = (line[i] - paeth(a, b, c)) & 0xff;
      }
      return;
    default:
      throw new Error(`bad PNG filter type ${filter}`);
  }
}

/** @param {string} type @param {Buffer} body */
function chunk(type, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

/** @param {Uint8Array} bytes */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// -------------------------------------------------------------------- diff

/**
 * Compare two images pixel by pixel.
 *
 * A pixel counts as different when any channel moves by more than
 * `channelTolerance`. That is the whole model: no perceptual colour space, no
 * anti-aliasing heuristics. The harness's job is to notice a chair drawn
 * ninety degrees out, which moves hundreds of pixels by a lot; a threshold
 * on the count of clearly-different pixels does that, and is easy to reason
 * about when it fires.
 *
 * The returned `diff` image is the expected image at a quarter of its
 * contrast, with every differing pixel painted solid red, so the disagreement
 * reads at a glance against the floor it happened on.
 *
 * `differingAtAll` counts the pixels that moved by any amount at all, ignoring
 * the tolerance. It is the harness's noise floor, reported on every run: as
 * long as it stays at zero the tolerance is unused headroom, and the day it
 * starts creeping up is the day the tolerance has to be re-measured rather
 * than guessed at.
 *
 * @param {Image} expected
 * @param {Image} actual
 * @param {{channelTolerance?: number}} [opts]
 * @returns {{differing:number, differingAtAll:number, total:number, sizeMismatch:boolean, diff:Image}}
 */
export function diffImages(expected, actual, opts = {}) {
  const channelTolerance = opts.channelTolerance ?? 0;
  const sizeMismatch = expected.width !== actual.width || expected.height !== actual.height;
  const width = Math.max(expected.width, actual.width);
  const height = Math.max(expected.height, actual.height);
  const diff = new Uint8Array(width * height * 4);
  let differing = 0;
  let differingAtAll = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const inA = x < expected.width && y < expected.height;
      const inB = x < actual.width && y < actual.height;
      const a = inA ? (y * expected.width + x) * 4 : -1;
      const b = inB ? (y * actual.width + x) * 4 : -1;

      let same = inA && inB;
      let identical = same;
      if (same) {
        for (let k = 0; k < 4; k++) {
          const delta = Math.abs(expected.data[a + k] - actual.data[b + k]);
          if (delta !== 0) identical = false;
          if (delta > channelTolerance) {
            same = false;
            break;
          }
        }
      }
      if (!identical) differingAtAll++;

      if (same) {
        // Faded expected pixel: pull each channel three quarters of the way to white.
        diff[o] = 191 + (expected.data[a] >> 2);
        diff[o + 1] = 191 + (expected.data[a + 1] >> 2);
        diff[o + 2] = 191 + (expected.data[a + 2] >> 2);
        diff[o + 3] = 255;
      } else {
        differing++;
        diff[o] = 220;
        diff[o + 1] = 30;
        diff[o + 2] = 30;
        diff[o + 3] = 255;
      }
    }
  }

  return {
    differing,
    differingAtAll,
    total: width * height,
    sizeMismatch,
    diff: { width, height, data: diff },
  };
}
