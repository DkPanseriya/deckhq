/**
 * Just enough MP4 to put H.264 frames in a file a browser plays.
 *
 * A recording of the floor is taken one frame at a time on a held clock
 * (`capture-kit.mjs`), and Chrome's own `VideoEncoder` turns those frames into
 * H.264. What comes out of an encoder is a list of chunks, not a file; this
 * writes the file. A muxer is a dependency everywhere else, and for one video
 * track at a constant frame rate with no audio it is a dozen boxes, so it is
 * written out here instead.
 *
 * WHAT IT WRITES
 *
 *   ftyp  moov  mdat          in that order ("faststart"): a page can show the
 *                             first frame before the last byte has arrived
 *   one `trak`, one `avc1` sample entry carrying the encoder's `avcC`
 *   stts  one entry: every frame lasts exactly `timescale / fps` ticks
 *   stss  the key frames, so a player can seek and a loop can restart
 *   stsz  every frame's size        stsc/stco  where the chunks of them are
 *
 * It is NOT fragmented (`moof`), has no edit list and no composition offsets:
 * frames are stored in the order they are shown, which is true of an encoder
 * that makes no B-frames and is checked by the caller, not assumed here.
 *
 * Pure: bytes in, bytes out. No file is read or written and nothing is
 * imported. `inspectMp4` reads a file back, for the tests and for a build
 * that needs a video's size.
 */

/* ------------------------------------------------------------------ bytes */

const u8 = (...v) => Uint8Array.from(v);
const u16 = (n) => u8((n >>> 8) & 255, n & 255);
const u32 = (n) => u8((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
const ascii = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const zeros = (n) => new Uint8Array(n);

/** @param {(Uint8Array|number[])[]} parts */
function concat(parts) {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** One box: its size, its four letters, its payload. */
const box = (type, ...payload) => {
  const body = concat(payload);
  return concat([u32(body.length + 8), ascii(type), body]);
};

/** A box that starts with a version byte and three flag bytes. */
const full = (type, version, flags, ...payload) =>
  box(type, u8(version, (flags >>> 16) & 255, (flags >>> 8) & 255, flags & 255), ...payload);

/** The identity matrix every header carries, in 16.16 and 2.30 fixed point. */
const MATRIX = concat([0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000].map((n) => u32(n)));

/* ------------------------------------------------------------------ boxes */

/**
 * The sample entry: what a decoder needs before the first frame.
 *
 * `colr` says which colours the numbers mean. Without it a player guesses
 * from the picture's size, and a video whose first frame is a shade off the
 * still it replaces is seen to flicker when it starts.
 */
function sampleEntry({ width, height, avcC, colorSpace }) {
  const colr = colorSpace
    ? box(
        'colr',
        ascii('nclx'),
        u16(colorSpace.primaries),
        u16(colorSpace.transfer),
        u16(colorSpace.matrix),
        u8(colorSpace.fullRange ? 0x80 : 0),
      )
    : u8();
  return box(
    'avc1',
    zeros(6),
    u16(1), // data reference index
    zeros(16),
    u16(width),
    u16(height),
    u32(0x00480000), // 72 dpi, both ways
    u32(0x00480000),
    zeros(4),
    u16(1), // frames per sample
    zeros(32), // compressor name
    u16(0x0018), // depth
    u16(0xffff),
    box('avcC', avcC),
    colr,
  );
}

/**
 * Write one H.264 video track as a plain MP4.
 *
 * @param {object} opts
 * @param {number} opts.width   the picture, in pixels; both sides even
 * @param {number} opts.height
 * @param {number} opts.fps     frames a second; every frame lasts `1 / fps`
 * @param {Uint8Array} opts.avcC  the `AVCDecoderConfigurationRecord`, which is
 *   `decoderConfig.description` from `VideoEncoder`'s first output
 * @param {{data:Uint8Array, key:boolean}[]} opts.samples  the encoded frames,
 *   in the order they are shown, each length-prefixed (`avc: {format:'avc'}`)
 * @param {{primaries:number, transfer:number, matrix:number, fullRange:boolean}} [opts.colorSpace]
 *   the code points of ISO/IEC 23091-2, for the `colr` box
 * @param {number} [opts.samplesPerChunk]  default: one second of frames
 * @returns {Uint8Array} the file
 */
export function muxMp4(opts) {
  const { width, height, fps, avcC, samples, colorSpace } = opts;
  if (!samples.length) throw new Error('mp4: no frames');
  if (!samples[0].key) throw new Error('mp4: the first frame is not a key frame');
  if (width % 2 || height % 2) throw new Error(`mp4: ${width}x${height} is not even`);
  if (!avcC || avcC.length < 7 || avcC[0] !== 1) throw new Error('mp4: no avcC record');
  // Ticks a second, chosen so one frame is a whole number of them at any rate
  // a recording is taken at: 60 -> 1000 ticks of 60000.
  const delta = 1000;
  const timescale = Math.round(fps * delta);
  const duration = samples.length * delta;
  const perChunk = Math.min(samples.length, Math.max(1, opts.samplesPerChunk ?? Math.round(fps)));
  const chunks = Math.ceil(samples.length / perChunk);
  const last = samples.length - (chunks - 1) * perChunk;

  const keys = samples.flatMap((s, i) => (s.key ? [i + 1] : []));
  const stsc = [u32(1), u32(perChunk), u32(1)];
  if (chunks > 1 && last !== perChunk) stsc.push(u32(chunks), u32(last), u32(1));

  /** The whole header, with the chunks placed `base` bytes into the file. */
  const moov = (base) => {
    const offsets = [];
    let at = base;
    samples.forEach((s, i) => {
      if (i % perChunk === 0) offsets.push(u32(at));
      at += s.data.length;
    });
    const stbl = box(
      'stbl',
      full('stsd', 0, 0, u32(1), sampleEntry({ width, height, avcC, colorSpace })),
      full('stts', 0, 0, u32(1), u32(samples.length), u32(delta)),
      full('stss', 0, 0, u32(keys.length), ...keys.map((k) => u32(k))),
      full('stsc', 0, 0, u32(stsc.length / 3), ...stsc),
      full('stsz', 0, 0, u32(0), u32(samples.length), ...samples.map((s) => u32(s.data.length))),
      full('stco', 0, 0, u32(offsets.length), ...offsets),
    );
    const minf = box(
      'minf',
      full('vmhd', 0, 1, zeros(8)),
      box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1))),
      stbl,
    );
    const mdia = box(
      'mdia',
      full('mdhd', 0, 0, u32(0), u32(0), u32(timescale), u32(duration), u16(0x55c4), u16(0)),
      full('hdlr', 0, 0, u32(0), ascii('vide'), zeros(12), ascii('DeckHQ\0')),
      minf,
    );
    const tkhd = full(
      'tkhd',
      0,
      3, // enabled, and in the movie
      u32(0),
      u32(0),
      u32(1), // track id
      u32(0),
      u32(duration),
      zeros(8),
      u16(0), // layer
      u16(0), // alternate group
      u16(0), // volume: a picture has none
      u16(0),
      MATRIX,
      u32(width << 16),
      u32(height << 16),
    );
    const mvhd = full(
      'mvhd',
      0,
      0,
      u32(0),
      u32(0),
      u32(timescale),
      u32(duration),
      u32(0x00010000), // rate 1.0
      u16(0x0100), // volume 1.0
      zeros(10),
      MATRIX,
      zeros(24),
      u32(2), // next track id
    );
    return box('moov', mvhd, box('trak', tkhd, mdia));
  };

  const ftyp = box('ftyp', ascii('isom'), u32(0x200), ascii('isomiso2avc1mp41'));
  // The header's size does not depend on where the frames are, so it is laid
  // out once to be measured and once more with the real offsets.
  const head = ftyp.length + moov(0).length + 8;
  const payload = samples.reduce((sum, s) => sum + s.data.length, 0);
  if (head + payload > 0xffffffff) throw new Error('mp4: over 4 GB; this writes 32-bit offsets');
  return concat([ftyp, moov(head), u32(payload + 8), ascii('mdat'), ...samples.map((s) => s.data)]);
}

/* ---------------------------------------------------------------- reading */

/** The boxes that hold boxes, on the one path this file writes. */
const PARENTS = new Set(['moov', 'trak', 'mdia', 'minf', 'dinf', 'stbl']);

/**
 * Walk a file's boxes, depth first.
 *
 * @param {Uint8Array} bytes
 * @returns {{type:string, path:string, start:number, size:number, body:number}[]}
 *   `body` is where the payload starts; `path` is `moov/trak/tkhd`
 */
export function mp4Boxes(bytes, from = 0, to = bytes.length, parent = '') {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = [];
  let at = from;
  while (at + 8 <= to) {
    const size = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (size < 8 || at + size > to) throw new Error(`mp4: ${type} at ${at} runs off its parent`);
    const path = parent ? `${parent}/${type}` : type;
    out.push({ type, path, start: at, size, body: at + 8 });
    if (PARENTS.has(type)) out.push(...mp4Boxes(bytes, at + 8, at + size, path));
    at += size;
  }
  if (at !== to) throw new Error(`mp4: ${to - at} bytes after the last box in ${parent || 'file'}`);
  return out;
}

/**
 * What a file says about itself: enough to check one this module wrote, and to
 * give a page a video's size without playing it.
 *
 * @param {Uint8Array} bytes
 */
export function inspectMp4(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxes = mp4Boxes(bytes);
  const at = (path) => {
    const found = boxes.find((b) => b.path === path);
    if (!found) throw new Error(`mp4: no ${path}`);
    return found;
  };
  const stbl = 'moov/trak/mdia/minf/stbl';
  /** The 32-bit numbers of a table, after its version, flags and `skip` more. */
  const table = (name, skip = 0) => {
    const b = at(`${stbl}/${name}`);
    const list = [];
    for (let p = b.body + 4 + skip; p + 4 <= b.start + b.size; p += 4) list.push(view.getUint32(p));
    return list;
  };
  const mdhd = at('moov/trak/mdia/mdhd');
  const tkhd = at('moov/trak/tkhd');
  const timescale = view.getUint32(mdhd.body + 12);
  const ticks = view.getUint32(mdhd.body + 16);
  const [sttsCount, frames, delta] = table('stts');
  const [, sampleCount, ...sizes] = table('stsz');
  const [, ...offsets] = table('stco');
  const [, ...sync] = table('stss');
  const [, ...stsc] = table('stsc');
  const stsd = at(`${stbl}/stsd`);
  const entry = stsd.body + 8;
  const mdat = at('mdat');
  return {
    top: boxes.filter((b) => !b.path.includes('/')).map((b) => b.type),
    brand: String.fromCharCode(...bytes.subarray(8, 12)),
    fragmented: boxes.some((b) => b.type === 'moof' || b.type === 'mvex'),
    codec: String.fromCharCode(...bytes.subarray(entry + 4, entry + 8)),
    width: view.getUint32(tkhd.body + 76) >>> 16,
    height: view.getUint32(tkhd.body + 80) >>> 16,
    codedWidth: view.getUint16(entry + 32),
    codedHeight: view.getUint16(entry + 34),
    timescale,
    seconds: ticks / timescale,
    fps: timescale / delta,
    constantRate: sttsCount === 1 && frames === sampleCount,
    frames: sampleCount,
    sync,
    sizes,
    offsets,
    stsc,
    mdat: { start: mdat.body, end: mdat.start + mdat.size },
  };
}
