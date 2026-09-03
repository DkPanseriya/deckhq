/**
 * The PNG codec and pixel diff behind `scripts/goldens.mjs`.
 *
 * The harness itself needs Chrome and is exercised by `npm run goldens:check`;
 * what can be tested without a browser is that the codec round-trips through
 * all five scanline filters, refuses what it does not understand, and that the
 * diff counts and paints exactly the pixels that moved.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';

import { crc32, decodePng, diffImages, encodePng } from '../../scripts/lib/png.mjs';

/** A small image with gradients, hard edges and varying alpha — every filter has work to do. */
function sample(width = 13, height = 9) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      data[o] = (x * 19) & 0xff;
      data[o + 1] = (y * 29) & 0xff;
      data[o + 2] = x > width / 2 ? 240 : 10;
      data[o + 3] = (x + y) % 3 === 0 ? 128 : 255;
    }
  }
  return { width, height, data };
}

test('crc32 matches the known value for "IEND"', () => {
  // Every PNG ends with this chunk, so its CRC is the best-known constant in the format.
  assert.equal(crc32(Buffer.from('IEND', 'latin1')), 0xae426082);
});

for (const filter of [0, 1, 2, 3, 4]) {
  test(`encode/decode round-trips through scanline filter ${filter}`, () => {
    const img = sample();
    const bytes = encodePng(img, { filter: /** @type {0|1|2|3|4} */ (filter) });
    const back = decodePng(bytes);
    assert.equal(back.width, img.width);
    assert.equal(back.height, img.height);
    assert.deepEqual(Buffer.from(back.data), Buffer.from(img.data));
  });
}

test('decodes 8-bit RGB (no alpha) as opaque RGBA', () => {
  // Chrome may hand back a PNG without an alpha channel; build one by hand.
  const width = 3;
  const height = 2;
  const rgb = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 10, 20, 30, 40, 50, 60, 100, 110, 120]);
  const png = handRolled(width, height, 2, rgb);
  const img = decodePng(png);
  assert.equal(img.width, width);
  assert.equal(img.height, height);
  assert.deepEqual([...img.data.subarray(0, 8)], [255, 0, 0, 255, 0, 255, 0, 255]);
  assert.deepEqual([...img.data.subarray(20, 24)], [100, 110, 120, 255]);
});

test('refuses what it does not decode, with a message', () => {
  assert.throws(() => decodePng(Buffer.from('not a png')), /bad signature/);
  const rgb = Buffer.alloc(1 + 3);
  assert.throws(() => decodePng(handRolled(1, 1, 3, rgb)), /palette/);
  assert.throws(() => decodePng(handRolled(1, 1, 2, rgb, { bitDepth: 16 })), /bit depth 16/);
  assert.throws(() => decodePng(handRolled(1, 1, 2, rgb, { interlace: 1 })), /interlaced/);
});

test('diff counts nothing for identical images and honours the channel tolerance', () => {
  const a = sample();
  const same = diffImages(a, a);
  assert.equal(same.differing, 0);
  assert.equal(same.differingAtAll, 0);
  assert.equal(same.total, a.width * a.height);
  assert.equal(same.sizeMismatch, false);

  const nudged = { ...a, data: Uint8Array.from(a.data) };
  nudged.data[0] = (nudged.data[0] + 5) & 0xff; // one channel, one pixel, by 5
  assert.equal(diffImages(a, nudged).differing, 1);
  assert.equal(diffImages(a, nudged, { channelTolerance: 4 }).differing, 1);
  assert.equal(diffImages(a, nudged, { channelTolerance: 5 }).differing, 0);
});

test('differingAtAll ignores the tolerance, so it can report the noise floor', () => {
  // This is what `goldens:check` prints every run: the tolerance says whether
  // the capture passes, `differingAtAll` says how much moved underneath it.
  // On the real floor that number is 36 pixels at a delta of 1 (WP-21).
  const a = sample();
  const b = { ...a, data: Uint8Array.from(a.data) };
  const nudged = [0, 4 * 4, 9 * 4];
  for (const o of nudged) b.data[o + 2] = (b.data[o + 2] + 1) & 0xff;

  for (const channelTolerance of [0, 1, 8, 24]) {
    const r = diffImages(a, b, { channelTolerance });
    assert.equal(r.differingAtAll, nudged.length, `at tolerance ${channelTolerance}`);
    // A one-count move is over a tolerance of 0 and under every larger one.
    assert.equal(r.differing, channelTolerance === 0 ? nudged.length : 0);
  }
});

test('diff paints every differing pixel red and fades the rest', () => {
  const a = sample();
  const b = { ...a, data: Uint8Array.from(a.data) };
  const moved = [(2 * a.width + 3) * 4, (5 * a.width + 7) * 4, (8 * a.width + 12) * 4];
  for (const o of moved) b.data[o + 1] = (b.data[o + 1] + 100) & 0xff;

  const { differing, diff } = diffImages(a, b);
  assert.equal(differing, moved.length);
  for (const o of moved) assert.deepEqual([...diff.data.subarray(o, o + 4)], [220, 30, 30, 255]);
  // An unmoved pixel is the expected pixel pulled three quarters of the way to white.
  assert.deepEqual(
    [...diff.data.subarray(0, 4)],
    [191 + (a.data[0] >> 2), 191 + (a.data[1] >> 2), 191 + (a.data[2] >> 2), 255],
  );
});

test('a size mismatch is reported, and pixels outside the smaller image count as different', () => {
  const a = sample(4, 4);
  // `a` with two extra columns on the right; the shared 4x4 is identical.
  const b = { width: 6, height: 4, data: new Uint8Array(6 * 4 * 4) };
  for (let y = 0; y < 4; y++) b.data.set(a.data.subarray(y * 16, (y + 1) * 16), y * 24);
  const r = diffImages(a, b);
  assert.equal(r.sizeMismatch, true);
  assert.equal(r.diff.width, 6);
  assert.equal(r.differing, 2 * 4);
  // Out-of-bounds pixels are not "equal underneath the tolerance" either.
  assert.equal(r.differingAtAll, 2 * 4);
});

/**
 * A minimal PNG assembled by hand, so the decoder's header checks can be
 * probed without going through our own encoder.
 * @param {number} width @param {number} height @param {number} colorType
 * @param {Buffer} pixels unfiltered scanline bytes, without filter bytes
 * @param {{bitDepth?:number, interlace?:number}} [o]
 */
function handRolled(width, height, colorType, pixels, o = {}) {
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = o.bitDepth ?? 8;
  ihdr[9] = colorType;
  ihdr[12] = o.interlace ?? 0;
  const chunk = (type, body) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
    return Buffer.concat([head, body, crc]);
  };
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
