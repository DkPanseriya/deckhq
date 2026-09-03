/**
 * A minimal GIF89a encoder, for the README's hero GIF.
 *
 * Neither ffmpeg nor ImageMagick can be assumed on the machine that cuts a
 * release, and a runtime or dev dependency for one image is a bad trade. So
 * this does the three things a GIF needs and nothing else:
 *
 *   1. decode the PNG frames `capture-hero.mjs` wrote (8-bit RGB/RGBA,
 *      non-interlaced — which is all Chrome's `Page.captureScreenshot` emits);
 *   2. build one global 255-colour palette by median cut over every frame,
 *      so the floor does not flicker between frames as a per-frame palette would;
 *   3. write each frame as the rectangle that actually changed, with unchanged
 *      pixels transparent under disposal method 1 ("leave in place"), LZW-coded.
 *
 * The floor is mostly still — one agent walks, a few type — so frame
 * differencing is what keeps a 1200×750 animation under a few hundred
 * kilobytes rather than tens of megabytes.
 *
 *   node scripts/gif-encoder.mjs --dir <frames dir> --out docs/media/hero.gif \
 *        [--fps 10] [--from -0.5] [--to 6] [--crop x,y,w,h]
 *
 * `--dir` is a directory holding `frames.json` (written by capture-hero.mjs:
 * `{ width, height, frames: [{ file, t }] }`, `t` in seconds relative to the
 * moment the agent was told its turn had ended) and the PNGs it names. `--from`
 * and `--to` trim in those same seconds; the frames are resampled to `--fps`
 * by nearest capture time, so capture jitter does not leak into the timing.
 *
 * Dev script only: `scripts/` is not in the published package.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import zlib from 'node:zlib';

// ------------------------------------------------------------------ PNG

/**
 * Decode an 8-bit, non-interlaced, truecolour PNG into RGBA.
 * @param {Buffer} buf
 * @returns {{width:number, height:number, data:Uint8Array}}
 */
export function decodePng(buf) {
  const sig = '89504e470d0a1a0a';
  if (buf.subarray(0, 8).toString('hex') !== sig) throw new Error('not a PNG');
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8];
      colorType = body[9];
      interlace = body[12];
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(
      `unsupported PNG: bit depth ${bitDepth}, colour type ${colorType}, interlace ${interlace}`,
    );
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    for (let i = 0; i < stride; i++) {
      const x = raw[rp++];
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v;
      switch (filter) {
        case 0:
          v = x;
          break;
        case 1:
          v = x + a;
          break;
        case 2:
          v = x + b;
          break;
        case 3:
          v = x + ((a + b) >> 1);
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default:
          throw new Error(`bad PNG filter ${filter} on row ${y}`);
      }
      cur[i] = v & 255;
    }
    let o = y * width * 4;
    for (let x = 0; x < width; x++) {
      const s = x * bpp;
      out[o++] = cur[s];
      out[o++] = cur[s + 1];
      out[o++] = cur[s + 2];
      out[o++] = bpp === 4 ? cur[s + 3] : 255;
    }
    prev.set(cur);
  }
  return { width, height, data: out };
}

/**
 * Crop an RGBA image.
 * @param {{width:number,height:number,data:Uint8Array}} img
 * @param {{x:number,y:number,w:number,h:number}} r
 */
export function crop(img, r) {
  const data = new Uint8Array(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) {
    const src = ((r.y + y) * img.width + r.x) * 4;
    data.set(img.data.subarray(src, src + r.w * 4), y * r.w * 4);
  }
  return { width: r.w, height: r.h, data };
}

// -------------------------------------------------------------- palette

/** 6 bits per channel: the histogram key space is 262,144 buckets. */
const Q = 6;
const QSHIFT = 8 - Q;
const key6 = (r, g, b) => ((r >> QSHIFT) << (2 * Q)) | ((g >> QSHIFT) << Q) | (b >> QSHIFT);

/**
 * Median-cut palette of at most `n` colours over every frame's pixels.
 * Colours are weighted by frequency; each box splits on its widest channel
 * at the count-weighted median.
 * @param {Uint8Array[]} frames RGBA buffers
 * @param {number} n
 * @returns {number[][]} [r,g,b] rows
 */
export function buildPalette(frames, n) {
  const hist = new Uint32Array(1 << (3 * Q));
  for (const px of frames) {
    for (let i = 0; i < px.length; i += 4) hist[key6(px[i], px[i + 1], px[i + 2])]++;
  }
  /** @type {number[]} keys with a non-zero count */
  const keys = [];
  for (let k = 0; k < hist.length; k++) if (hist[k]) keys.push(k);
  const chan = (k, c) => ((k >> ((2 - c) * Q)) & ((1 << Q) - 1)) << QSHIFT;

  /** @param {number[]} ks */
  const box = (ks) => {
    const lo = [255, 255, 255];
    const hi = [0, 0, 0];
    let count = 0;
    for (const k of ks) {
      count += hist[k];
      for (let c = 0; c < 3; c++) {
        const v = chan(k, c);
        if (v < lo[c]) lo[c] = v;
        if (v > hi[c]) hi[c] = v;
      }
    }
    const range = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
    const axis = range.indexOf(Math.max(...range));
    return { ks, count, spread: range[axis], axis };
  };

  const boxes = [box(keys)];
  while (boxes.length < n) {
    // Split the box with the widest colour range that still has ≥ 2 colours,
    // at the midpoint of that range rather than the count-weighted median.
    // The median is the textbook cut, and on this floor it is wrong: a crimson
    // badge is a few hundred pixels sharing a box with acres of plant green,
    // so a population split lands inside the green and the badge is averaged
    // into olive. A midpoint cut isolates a distinct hue however rare it is.
    let best = -1;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].ks.length < 2) continue;
      if (best === -1 || boxes[i].spread > boxes[best].spread) best = i;
    }
    if (best === -1) break;
    const b = boxes[best];
    b.ks.sort((p, q) => chan(p, b.axis) - chan(q, b.axis));
    const lo = chan(b.ks[0], b.axis);
    const mid = lo + b.spread / 2;
    let cut = 0;
    while (cut < b.ks.length - 2 && chan(b.ks[cut + 1], b.axis) <= mid) cut++;
    boxes.splice(best, 1, box(b.ks.slice(0, cut + 1)), box(b.ks.slice(cut + 1)));
  }
  return boxes.map((b) => {
    const sum = [0, 0, 0];
    for (const k of b.ks) {
      for (let c = 0; c < 3; c++) sum[c] += chan(k, c) * hist[k];
    }
    // Bucket centre, not bucket floor: 6-bit truncation would otherwise bias
    // every colour dark by up to 3/255.
    return sum.map((s) => Math.min(255, Math.round(s / b.count) + (1 << (QSHIFT - 1))));
  });
}

/**
 * Map RGBA pixels to palette indices, nearest by squared distance, cached by
 * the 6-bit bucket so each distinct bucket is searched once.
 * @param {Uint8Array} px
 * @param {number[][]} palette
 * @param {Int16Array} cache shared across frames; fill(-1) before first use
 * @returns {Uint8Array}
 */
export function indexPixels(px, palette, cache) {
  const out = new Uint8Array(px.length / 4);
  for (let i = 0, o = 0; i < px.length; i += 4, o++) {
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];
    const k = key6(r, g, b);
    let idx = cache[k];
    if (idx < 0) {
      let bestD = Infinity;
      for (let p = 0; p < palette.length; p++) {
        const dr = r - palette[p][0];
        const dg = g - palette[p][1];
        const db = b - palette[p][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) {
          bestD = d;
          idx = p;
        }
      }
      cache[k] = idx;
    }
    out[o] = idx;
  }
  return out;
}

// ------------------------------------------------------------------ LZW

/**
 * GIF-flavoured LZW: variable code width from `minCodeSize + 1` to 12 bits,
 * clear code emitted first and whenever the table fills.
 * @param {Uint8Array} indices
 * @param {number} minCodeSize
 * @returns {Uint8Array}
 */
export function lzwEncode(indices, minCodeSize = 8) {
  const CLEAR = 1 << minCodeSize;
  const EOI = CLEAR + 1;
  const MAX = 4096;
  // Dictionary as a flat table keyed on (prefixCode << 8 | nextByte).
  const dict = new Int32Array(MAX << 8).fill(-1);
  const out = [];
  let codeSize = minCodeSize + 1;
  let nextCode = EOI + 1;
  let bitBuf = 0;
  let bitCnt = 0;
  const emit = (code) => {
    bitBuf |= code << bitCnt;
    bitCnt += codeSize;
    while (bitCnt >= 8) {
      out.push(bitBuf & 255);
      bitBuf >>>= 8;
      bitCnt -= 8;
    }
  };
  emit(CLEAR);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const c = indices[i];
    const k = (prefix << 8) | c;
    if (dict[k] !== -1) {
      prefix = dict[k];
      continue;
    }
    emit(prefix);
    if (nextCode < MAX) {
      dict[k] = nextCode++;
      // The decoder widens its codes one entry behind us, so widen after the
      // table has grown *past* the current width, not on reaching it.
      if (nextCode > 1 << codeSize && codeSize < 12) codeSize++;
    } else {
      emit(CLEAR);
      dict.fill(-1);
      nextCode = EOI + 1;
      codeSize = minCodeSize + 1;
    }
    prefix = c;
  }
  emit(prefix);
  emit(EOI);
  if (bitCnt > 0) out.push(bitBuf & 255);
  return Uint8Array.from(out);
}

// ------------------------------------------------------------------ GIF

/** Split a byte stream into ≤ 255-byte GIF sub-blocks, zero-terminated. */
function subBlocks(bytes) {
  const parts = [];
  for (let i = 0; i < bytes.length; i += 255) {
    const chunk = bytes.subarray(i, Math.min(i + 255, bytes.length));
    parts.push(Buffer.from([chunk.length]), Buffer.from(chunk));
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

const u16 = (n) => Buffer.from([n & 255, (n >> 8) & 255]);

/**
 * Encode indexed frames into a looping GIF89a.
 *
 * @param {{width:number, height:number, palette:number[][], frames:{indices:Uint8Array, delayCs:number}[]}} opts
 *   `palette` has ≤ 255 entries; index 255 is the transparent slot.
 * @returns {Buffer}
 */
export function encodeGif({ width, height, palette, frames }) {
  const TRANSPARENT = 255;
  const parts = [];
  parts.push(Buffer.from('GIF89a', 'latin1'));
  // Logical screen: global colour table, 8 bits per colour, 256 entries.
  parts.push(u16(width), u16(height), Buffer.from([0xf7, 0, 0]));
  const table = Buffer.alloc(256 * 3);
  palette.forEach((c, i) => table.set(c, i * 3));
  parts.push(table);
  // NETSCAPE2.0 application extension: loop forever.
  parts.push(
    Buffer.from([0x21, 0xff, 0x0b]),
    Buffer.from('NETSCAPE2.0', 'latin1'),
    Buffer.from([0x03, 0x01, 0x00, 0x00, 0x00]),
  );

  /** @type {Uint8Array|null} */
  let prev = null;
  for (const frame of frames) {
    let x0 = 0;
    let y0 = 0;
    let x1 = width - 1;
    let y1 = height - 1;
    let pixels = frame.indices;
    if (prev) {
      // Bounding box of the pixels that changed since the frame on screen.
      x0 = width;
      y0 = height;
      x1 = -1;
      y1 = -1;
      for (let y = 0; y < height; y++) {
        const row = y * width;
        for (let x = 0; x < width; x++) {
          if (frame.indices[row + x] !== prev[row + x]) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      if (x1 < 0) {
        // Nothing moved: a 1×1 transparent frame keeps the timing honest.
        x0 = y0 = 0;
        x1 = y1 = 0;
      }
      const w = x1 - x0 + 1;
      const h = y1 - y0 + 1;
      pixels = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y0 + y) * width + (x0 + x);
          pixels[y * w + x] = frame.indices[i] === prev[i] ? TRANSPARENT : frame.indices[i];
        }
      }
    }
    // Graphic control extension: disposal 1 (leave), transparency after frame 0.
    const flags = (1 << 2) | (prev ? 1 : 0);
    parts.push(
      Buffer.from([0x21, 0xf9, 0x04, flags]),
      u16(frame.delayCs),
      Buffer.from([TRANSPARENT, 0x00]),
    );
    // Image descriptor, no local colour table.
    parts.push(
      Buffer.from([0x2c]),
      u16(x0),
      u16(y0),
      u16(x1 - x0 + 1),
      u16(y1 - y0 + 1),
      Buffer.from([0x00]),
    );
    parts.push(Buffer.from([8]), subBlocks(lzwEncode(pixels, 8)));
    prev = frame.indices;
  }
  parts.push(Buffer.from([0x3b]));
  return Buffer.concat(parts);
}

// ------------------------------------------------------------------ CLI

if (process.argv[1] && path.basename(process.argv[1]) === 'gif-encoder.mjs') {
  const argv = process.argv.slice(2);
  const opt = (name, fallback) => {
    const i = argv.indexOf(name);
    return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
  };
  const dir = opt('--dir', '');
  const out = path.resolve(opt('--out', 'docs/media/hero.gif'));
  const fps = Number(opt('--fps', 10));
  const from = Number(opt('--from', -Infinity));
  const to = Number(opt('--to', Infinity));
  const cropArg = opt('--crop', '');
  if (!dir) throw new Error('--dir <frames dir> is required');

  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'frames.json'), 'utf8'));
  const captured = manifest.frames.filter((f) => f.t >= from && f.t <= to);
  if (captured.length === 0) throw new Error('no frames in the requested window');

  // Resample to a fixed frame rate by nearest capture time.
  const start = Math.max(from, captured[0].t);
  const end = Math.min(to, captured[captured.length - 1].t);
  const picks = [];
  for (let t = start; t <= end + 1e-9; t += 1 / fps) {
    let best = captured[0];
    for (const f of captured) if (Math.abs(f.t - t) < Math.abs(best.t - t)) best = f;
    if (picks.length === 0 || picks[picks.length - 1] !== best) picks.push(best);
  }

  const rect = cropArg
    ? (([x, y, w, h]) => ({ x, y, w, h }))(cropArg.split(',').map(Number))
    : null;
  const images = picks.map((f) => {
    const img = decodePng(fs.readFileSync(path.join(dir, f.file)));
    return rect ? crop(img, rect) : img;
  });
  const { width, height } = images[0];
  process.stdout.write(`${images.length} frames at ${width}x${height}, palette…`);
  const palette = buildPalette(
    images.map((i) => i.data),
    255,
  );
  const cache = new Int16Array(1 << (3 * Q)).fill(-1);
  const delayCs = Math.round(100 / fps);
  const frames = images.map((img) => ({ indices: indexPixels(img.data, palette, cache), delayCs }));
  const gif = encodeGif({ width, height, palette, frames });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, gif);
  process.stdout.write(
    ` ${palette.length} colours\nwrote ${out}  ${width}x${height}  ${frames.length} frames @ ${fps} fps (${(
      frames.length / fps
    ).toFixed(1)} s)  ${(gif.length / 1024).toFixed(0)} KB\n`,
  );
}
