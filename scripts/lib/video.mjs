/**
 * A recording as a video: sixty frames a second, in a file a browser plays.
 *
 * A GIF cannot be fluid. Its frame delay is written in hundredths of a second
 * and a browser treats anything under two of them as ten, so fifty frames a
 * second is the format's ceiling, at 256 colours. So a recording that is meant
 * to be watched is written as H.264 in an MP4 instead, and the GIF is kept for
 * the places that render nothing else.
 *
 * No encoder is added to do it. The tools already drive a Chrome
 * (`src/cli/chrome.mjs`), and Chrome has one: `VideoEncoder`, which takes a
 * picture and a timestamp and hands back a chunk. The frames are the ones the
 * held clock stepped (`capture-kit.mjs`), so each is given the instant it
 * belongs to, `i / fps`, exactly; nothing here depends on how fast this
 * machine is. `mp4-mux.mjs` puts the chunks in a file.
 *
 * `MediaRecorder` is not used: it stamps frames with the time they happened to
 * arrive and writes a fragmented file.
 *
 * AND THEN IT IS MEASURED. `measureVideo` loads the file that was written into
 * a `<video>` in the same Chrome and reports what the browser found: how long,
 * how large, how many frames it decoded playing it through, how many distinct
 * ones it presented, and how far the first frame's pixels are from the PNG it
 * was made from. `writeVideo` prints that beside the file, in `<name>.txt`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { findChrome, pathToFileUrl, withChrome } from '../../src/cli/chrome.mjs';
import { inspectMp4, muxMp4 } from './mp4-mux.mjs';
import { encodePng } from './png.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** ISO/IEC 23091-2 code points for the names WebCodecs uses. */
const CODE = {
  primaries: { bt709: 1, bt470bg: 5, smpte170m: 6, bt2020: 9, smpte432: 12 },
  transfer: { bt709: 1, smpte170m: 6, linear: 8, 'iec61966-2-1': 13, pq: 16, hlg: 18 },
  matrix: { rgb: 0, bt709: 1, bt470bg: 5, smpte170m: 6, 'bt2020-ncl': 9 },
};

/** A frame as base64 PNG: a file, the bytes of one, or pixels. */
function pngOf(frame) {
  if (typeof frame === 'string') return fs.readFileSync(frame).toString('base64');
  if (Buffer.isBuffer(frame)) return frame.toString('base64');
  if (frame && frame.base64) return frame.base64;
  return Buffer.from(encodePng(frame)).toString('base64');
}

/**
 * A page of our own to work in. `about:blank` is not a secure context and has
 * no `VideoEncoder`; a file is, and loads nothing.
 */
async function onBlankPage(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deckhq-video-'));
  const page = path.join(dir, 'page.html');
  fs.writeFileSync(page, '<!doctype html><meta charset="utf-8"><title>video</title>');
  const chromePath = findChrome();
  if (!chromePath) throw new Error('No Chrome or Edge found. Set CHROME_PATH and try again.');
  try {
    return await withChrome(
      // Sound never plays, but a muted video still wants the policy out of its way.
      {
        chromePath,
        width: 1280,
        height: 720,
        extraArgs: ['--autoplay-policy=no-user-gesture-required', '--force-color-profile=srgb'],
      },
      async (client) => {
        const evaluate = async (expression) => {
          const { result, exceptionDetails } = await client.send('Runtime.evaluate', {
            expression,
            returnByValue: true,
            awaitPromise: true,
          });
          if (exceptionDetails) {
            throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
          }
          return result.value;
        };
        await client.send('Page.navigate', { url: pathToFileUrl(page) });
        for (let i = 0; i < 40 && !(await evaluate('typeof VideoEncoder === "function"')); i++) {
          await sleep(100);
        }
        return fn(evaluate);
      },
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
}

/* ----------------------------------------------------------------- encode */

/** Installed in the page: one encoder, fed one PNG at a time. */
const ENCODER = `(() => {
  const bytesOf = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const b64Of = (bytes) => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
  };
  const enc = { chunks: [], error: null, config: null };
  enc.start = async (cfg) => {
    const support = await VideoEncoder.isConfigSupported(cfg.encoder);
    if (!support.supported) throw new Error('this Chrome cannot encode ' + JSON.stringify(cfg.encoder));
    enc.cfg = cfg;
    enc.canvas = new OffscreenCanvas(cfg.encoder.width, cfg.encoder.height);
    enc.ctx = enc.canvas.getContext('2d', { alpha: false });
    enc.ctx.imageSmoothingQuality = 'high';
    enc.encoder = new VideoEncoder({
      output: (chunk, meta) => {
        if (meta && meta.decoderConfig) enc.config = meta.decoderConfig;
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        enc.chunks.push({ data, key: chunk.type === 'key', at: chunk.timestamp });
      },
      error: (e) => { enc.error = String(e && e.message || e); },
    });
    enc.encoder.configure(cfg.encoder);
    return true;
  };
  enc.add = async (b64, i) => {
    if (enc.error) throw new Error(enc.error);
    const bitmap = await createImageBitmap(new Blob([bytesOf(b64)], { type: 'image/png' }));
    const { width, height } = enc.cfg.encoder;
    // The same size, or one odd pixel trimmed: drawn one to one. Otherwise scaled.
    const same = bitmap.width - width >= 0 && bitmap.width - width <= 1 &&
      bitmap.height - height >= 0 && bitmap.height - height <= 1;
    if (same) enc.ctx.drawImage(bitmap, 0, 0);
    else enc.ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const us = 1e6 / enc.cfg.fps;
    const frame = new VideoFrame(enc.canvas, { timestamp: Math.round(i * us), duration: Math.round(us) });
    enc.encoder.encode(frame, { keyFrame: i % enc.cfg.keyEvery === 0 });
    frame.close();
    while (enc.encoder.encodeQueueSize > 2) await new Promise((r) => setTimeout(r, 2));
    return same;
  };
  enc.finish = async () => {
    await enc.encoder.flush();
    enc.encoder.close();
    if (enc.error) throw new Error(enc.error);
    const d = enc.config && enc.config.description;
    const cs = (enc.config && enc.config.colorSpace) || null;
    return {
      codec: enc.config && enc.config.codec,
      description: d ? b64Of(new Uint8Array(d.buffer || d, d.byteOffset || 0, d.byteLength)) : '',
      colorSpace: cs && { primaries: cs.primaries, transfer: cs.transfer, matrix: cs.matrix, fullRange: !!cs.fullRange },
      chunks: enc.chunks.map((c) => ({ key: c.key, at: c.at, size: c.data.length })),
    };
  };
  /** The bytes of chunks [from, to), end to end. */
  enc.take = (from, to) => {
    const part = enc.chunks.slice(from, to);
    const out = new Uint8Array(part.reduce((n, c) => n + c.data.length, 0));
    let at = 0;
    for (const c of part) { out.set(c.data, at); at += c.data.length; }
    return b64Of(out);
  };
  window.__enc = enc;
  return true;
})()`;

/**
 * The lowest H.264 level that admits a picture this large this often, as the
 * two hex digits of a codec string. A lower level is one more device that can
 * play the file, so it is never asked for higher than it has to be.
 */
export function avcLevel(width, height, fps) {
  const blocks = Math.ceil(width / 16) * Math.ceil(height / 16);
  const levels = [
    [0x1f, 3600, 108000],
    [0x28, 8192, 245760],
    [0x2a, 8704, 522240],
    [0x33, 36864, 983040],
    [0x34, 36864, 2073600],
  ];
  const fit = levels.find(([, frame, second]) => blocks <= frame && blocks * fps <= second);
  if (!fit) throw new Error(`${width}x${height} at ${fps} fps is past H.264 level 5.2`);
  return fit[0].toString(16).padStart(2, '0');
}

/**
 * Encode frames in the page and bring the chunks back.
 *
 * @returns {Promise<{samples:{data:Uint8Array,key:boolean}[], avcC:Uint8Array, codec:string,
 *   colorSpace:any, said:any, scaled:boolean}>} `said` is the colour space as the
 *   encoder named it; `colorSpace` is the same thing as code points, for the file
 */
async function encode(evaluate, frames, fps, cfg) {
  await evaluate(ENCODER);
  await evaluate(`window.__enc.start(${JSON.stringify(cfg)})`);
  let scaled = false;
  for (let i = 0; i < frames.length; i++) {
    const same = await evaluate(`window.__enc.add("${pngOf(frames[i])}", ${i})`);
    if (!same) scaled = true;
  }
  const done = await evaluate('window.__enc.finish()');
  if (!done.description) throw new Error('the encoder gave no avcC record');
  if (done.chunks.length !== frames.length) {
    throw new Error(`${frames.length} frames went in and ${done.chunks.length} chunks came out`);
  }
  // Stored in the order they are shown: true of an encoder that makes no
  // B-frames, and checked rather than assumed, because the file has no table
  // that could say otherwise.
  const us = 1e6 / fps;
  done.chunks.forEach((c, i) => {
    if (c.at !== Math.round(i * us)) {
      throw new Error(`chunk ${i} is stamped ${c.at} us, not ${Math.round(i * us)}`);
    }
  });
  const samples = [];
  // Fetched a few megabytes at a time, so no one message is a whole video.
  for (let from = 0; from < done.chunks.length;) {
    let to = from;
    let size = 0;
    while (to < done.chunks.length && (to === from || size + done.chunks[to].size < 6e6)) {
      size += done.chunks[to++].size;
    }
    const bytes = Buffer.from(await evaluate(`window.__enc.take(${from}, ${to})`), 'base64');
    let at = 0;
    for (let i = from; i < to; i++) {
      samples.push({
        data: bytes.subarray(at, at + done.chunks[i].size),
        key: done.chunks[i].key,
      });
      at += done.chunks[i].size;
    }
    from = to;
  }
  const cs = done.colorSpace;
  const colorSpace =
    cs && cs.primaries in CODE.primaries && cs.transfer in CODE.transfer && cs.matrix in CODE.matrix
      ? {
          primaries: CODE.primaries[cs.primaries],
          transfer: CODE.transfer[cs.transfer],
          matrix: CODE.matrix[cs.matrix],
          fullRange: cs.fullRange,
        }
      : undefined;
  return {
    samples,
    avcC: Buffer.from(done.description, 'base64'),
    codec: done.codec,
    colorSpace,
    said: cs,
    scaled,
  };
}

/* ---------------------------------------------------------------- measure */

/**
 * Run in the page: play `window.__mp4` (base64) in a `<video>` and say what
 * was found. `window.__first` is the PNG the first frame was made from.
 */
const MEASURE = `(async () => {
  const bytesOf = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  document.body.replaceChildren(v);
  const loaded = new Promise((ok, no) => {
    v.addEventListener('loadeddata', ok, { once: true });
    v.addEventListener('error', () => no(new Error('the video did not load: ' +
      (v.error ? v.error.code + ' ' + v.error.message : 'no reason given'))), { once: true });
  });
  v.src = URL.createObjectURL(new Blob([bytesOf(window.__mp4)], { type: 'video/mp4' }));
  await loaded;
  const out = { seconds: v.duration, width: v.videoWidth, height: v.videoHeight };

  // The first frame against the picture it was made from, pixel by pixel.
  if (window.__first) {
    const still = await createImageBitmap(new Blob([bytesOf(window.__first)], { type: 'image/png' }));
    const pixels = (source) => {
      const c = new OffscreenCanvas(v.videoWidth, v.videoHeight);
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(source, 0, 0, c.width, c.height);
      return ctx.getImageData(0, 0, c.width, c.height).data;
    };
    const a = pixels(v);
    const b = pixels(still);
    let sum = 0;
    let worst = 0;
    for (let i = 0; i < a.length; i += 4) {
      for (let k = 0; k < 3; k++) {
        const d = Math.abs(a[i + k] - b[i + k]);
        sum += d;
        if (d > worst) worst = d;
      }
    }
    out.firstFrame = { mean: sum / ((a.length / 4) * 3), worst };
  }

  // Played through once, at its own speed. Every frame the browser presents
  // reports the media time it belongs to; distinct ones are counted.
  const times = new Set();
  const seen = (_now, meta) => {
    times.add(meta.mediaTime.toFixed(4));
    v.requestVideoFrameCallback(seen);
  };
  v.requestVideoFrameCallback(seen);
  const t0 = performance.now();
  const ended = new Promise((ok) => v.addEventListener('ended', ok, { once: true }));
  await v.play();
  await Promise.race([ended, new Promise((r) => setTimeout(r, v.duration * 3000 + 8000))]);
  out.playedFor = (performance.now() - t0) / 1000;
  out.ended = v.ended;
  const q = v.getVideoPlaybackQuality();
  out.decoded = q.totalVideoFrames;
  out.dropped = q.droppedVideoFrames;
  out.presented = times.size;
  const sorted = [...times].map(Number).sort((x, y) => x - y);
  out.lastMediaTime = sorted.length ? sorted[sorted.length - 1] : null;
  URL.revokeObjectURL(v.src);
  return out;
})()`;

/** Put a file's bytes in the page, a few megabytes a message. */
async function hand(evaluate, name, base64) {
  await evaluate(`window.${name} = ''`);
  for (let at = 0; at < base64.length; at += 4e6) {
    await evaluate(`window.${name} += "${base64.slice(at, at + 4e6)}"`);
  }
}

async function measure(evaluate, bytes, first) {
  await hand(evaluate, '__mp4', Buffer.from(bytes).toString('base64'));
  await hand(evaluate, '__first', first || '');
  return evaluate(MEASURE);
}

/**
 * What Chrome finds when it plays a video file: `{seconds, width, height,
 * decoded, dropped, presented, firstFrame?}`. Nothing is taken on trust from
 * the file's own tables; those are in `container`, read separately.
 *
 * @param {string} file an MP4
 * @param {string|Buffer} [first] the PNG its first frame was made from
 */
export async function measureVideo(file, first) {
  const bytes = fs.readFileSync(file);
  const measured = await onBlankPage((evaluate) =>
    measure(evaluate, bytes, first ? pngOf(first) : ''),
  );
  return { ...measured, container: inspectMp4(bytes) };
}

/**
 * One decoded frame of a video file, as PNG bytes: what a reader sees at that
 * moment, compression and all. A poster is the frame before it was encoded,
 * so looking at a poster says nothing about what the encoder did to it.
 *
 * @param {string} file an MP4
 * @param {number} seconds
 * @returns {Promise<Buffer>}
 */
export async function videoStill(file, seconds) {
  const bytes = fs.readFileSync(file);
  const png = await onBlankPage(async (evaluate) => {
    await hand(evaluate, '__mp4', bytes.toString('base64'));
    return evaluate(`(async () => {
      const v = document.createElement('video');
      v.muted = true;
      v.preload = 'auto';
      const data = Uint8Array.from(atob(window.__mp4), (c) => c.charCodeAt(0));
      v.src = URL.createObjectURL(new Blob([data], { type: 'video/mp4' }));
      await new Promise((ok) => v.addEventListener('loadeddata', ok, { once: true }));
      const shown = new Promise((ok) => v.requestVideoFrameCallback(ok));
      v.currentTime = ${Number(seconds)};
      await shown;
      const c = document.createElement('canvas');
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      c.getContext('2d').drawImage(v, 0, 0);
      return c.toDataURL('image/png').split(',')[1];
    })()`);
  });
  return Buffer.from(png, 'base64');
}

/* ------------------------------------------------------------------ write */

/**
 * Encode frames as H.264 and write them as an MP4, then play the file in
 * Chrome and report what was measured.
 *
 * `frames` are PNG files, PNG bytes or RGBA images, one per step of the clock.
 * Frame `i` is stamped `i / fps` exactly. `width` and `height` default to the
 * first frame's, trimmed to even; a frame of another size is scaled to them.
 *
 * @param {string} file
 * @param {(string|Buffer|{width:number,height:number,data:Uint8Array})[]} frames
 * @param {number} fps
 * @param {{width?:number, height?:number, bitrate?:number, keyEvery?:number,
 *          measure?:boolean, encoder?:object}} [opts]
 *   `bitrate` in bits a second (default: a tenth of a bit a pixel a frame). It
 *   is a ceiling and not a size: Chrome's software encoder has a quality it
 *   does not go past, and a floor that mostly stands still reaches it far
 *   under the default. Lower it only to make a file smaller and softer.
 *   `keyEvery` in frames (default: two seconds, so a seek never decodes more).
 *   `encoder` is merged over the `VideoEncoder` configuration, for a trial.
 */
export async function writeVideo(file, frames, fps, opts = {}) {
  if (!frames.length) throw new Error('writeVideo: no frames');
  const first = pngOf(frames[0]);
  const head = Buffer.from(first.slice(0, 44), 'base64');
  const width = opts.width ?? head.readUInt32BE(16) - (head.readUInt32BE(16) % 2);
  const height = opts.height ?? head.readUInt32BE(20) - (head.readUInt32BE(20) % 2);
  const bitrate = Math.round(opts.bitrate ?? width * height * fps * 0.1);
  const cfg = {
    fps,
    keyEvery: opts.keyEvery ?? Math.round(fps * 2),
    encoder: {
      codec: `avc1.6400${avcLevel(width, height, fps)}`,
      width,
      height,
      framerate: fps,
      bitrate,
      bitrateMode: 'variable',
      latencyMode: 'quality',
      // A picture of an interface, not of the world. Measured on 60 frames of
      // Your Office at 1404x1212 and 20 Mbit/s: the key frame is the same
      // 58 KB either way, and the frames after it average 0.5 KB with this
      // hint against 2.4 KB without, at the same picture.
      contentHint: 'detail',
      avc: { format: 'avc' },
      ...opts.encoder,
    },
  };
  const t0 = Date.now();
  const result = await onBlankPage(async (evaluate) => {
    const encoded = await encode(evaluate, frames, fps, cfg);
    const bytes = muxMp4({
      width,
      height,
      fps,
      avcC: encoded.avcC,
      samples: encoded.samples,
      colorSpace: encoded.colorSpace,
    });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
    const measured = opts.measure === false ? null : await measure(evaluate, bytes, first);
    return { encoded, bytes, measured };
  });
  const container = inspectMp4(result.bytes);
  return {
    file,
    bytes: result.bytes.length,
    width,
    height,
    fps,
    frames: frames.length,
    seconds: frames.length / fps,
    bitrate,
    codec: result.encoded.codec,
    colorSpace: result.encoded.said,
    scaled: result.encoded.scaled,
    keyFrames: container.sync.length,
    container,
    measured: result.measured,
    took: (Date.now() - t0) / 1000,
  };
}

/** One line a person can read: what was written, and what Chrome measured. */
export function describeVideo(r) {
  const m = r.measured;
  const head =
    `${path.basename(r.file)}: ${(r.bytes / 1024).toFixed(0)} KB (${r.bytes} bytes), ` +
    `${r.width}x${r.height}, ${r.frames} frames at ${r.fps} fps written, ${r.codec}, ` +
    `${r.keyFrames} key frames`;
  if (!m) return `${head}; not measured`;
  const rate = m.seconds ? (m.decoded / m.seconds).toFixed(2) : '?';
  return (
    `${head}; measured in Chrome: ${m.width}x${m.height}, ${m.seconds.toFixed(3)} s, ` +
    `${m.decoded} frames decoded (${rate} a second), ${m.presented} distinct presented, ` +
    `${m.dropped} dropped in ${m.playedFor.toFixed(2)} s of playing` +
    (m.firstFrame
      ? `, first frame ${m.firstFrame.mean.toFixed(2)}/255 mean from its PNG (worst ${m.firstFrame.worst})`
      : '')
  );
}
