/**
 * The MP4 a recording of the floor is written as (`scripts/lib/mp4-mux.mjs`).
 *
 * The frames here are not H.264: a muxer does not look inside a frame, so any
 * bytes will do, and bytes that say which frame they are make it possible to
 * check that the tables point at the right ones. That the file PLAYS is not
 * something a unit test can know; `scripts/lib/video.mjs` measures that in
 * Chrome for every file it writes, and prints what it measured.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { inspectMp4, mp4Boxes, muxMp4 } from '../../scripts/lib/mp4-mux.mjs';

/** A minimal `AVCDecoderConfigurationRecord`: version 1, High, level 4.2. */
const AVCC = Uint8Array.from([1, 0x64, 0x00, 0x2a, 0xff, 0xe0, 0x00]);

/** Frame `i` is `10 + i % 7` bytes of the value `i`: sizes differ, contents are known. */
const frames = (count, keyEvery) =>
  Array.from({ length: count }, (_, i) => ({
    data: new Uint8Array(10 + (i % 7)).fill(i % 256),
    key: i % keyEvery === 0,
  }));

const file = (count = 240, fps = 60, more = {}) =>
  muxMp4({ width: 1920, height: 1080, fps, avcC: AVCC, samples: frames(count, 60), ...more });

test('the file is ftyp, moov, mdat, in that order, and is not fragmented', () => {
  const bytes = file();
  const info = inspectMp4(bytes);
  assert.deepEqual(info.top, ['ftyp', 'moov', 'mdat']);
  assert.equal(info.brand, 'isom');
  assert.equal(info.fragmented, false);
  const paths = mp4Boxes(bytes).map((b) => b.path);
  assert.ok(paths.indexOf('moov') < paths.indexOf('mdat'), 'moov is not before mdat');
  for (const needed of ['mvhd', 'trak/tkhd', 'trak/mdia/mdhd', 'trak/mdia/hdlr']) {
    assert.ok(paths.includes(`moov/${needed}`), `no ${needed}`);
  }
  for (const table of ['stsd', 'stts', 'stss', 'stsc', 'stsz', 'stco']) {
    assert.ok(paths.includes(`moov/trak/mdia/minf/stbl/${table}`), `no ${table}`);
  }
  assert.ok(!paths.some((p) => /moof|mvex|ctts|elst/.test(p)), 'a box this file never writes');
  // The boxes account for every byte: nothing before, between or after them.
  const top = mp4Boxes(bytes).filter((b) => !b.path.includes('/'));
  assert.equal(
    top.reduce((sum, b) => sum + b.size, 0),
    bytes.length,
  );
});

test('it says how many frames, how long, how large, and at one constant rate', () => {
  const info = inspectMp4(file(240, 60));
  assert.equal(info.frames, 240);
  assert.equal(info.seconds, 4);
  assert.equal(info.fps, 60);
  assert.equal(info.constantRate, true);
  assert.equal(info.codec, 'avc1');
  assert.deepEqual([info.width, info.height], [1920, 1080]);
  assert.deepEqual([info.codedWidth, info.codedHeight], [1920, 1080]);

  const odd = inspectMp4(file(125, 25));
  assert.equal(odd.frames, 125);
  assert.equal(odd.seconds, 5);
  assert.equal(odd.fps, 25);
});

test('stss lists the key frames, counted from one', () => {
  const info = inspectMp4(file(240, 60));
  assert.deepEqual(info.sync, [1, 61, 121, 181]);
});

test('stsz, stsc and stco lead to every frame, byte for byte', () => {
  for (const [count, perChunk] of [
    [240, undefined],
    [250, 60],
    [7, 3],
    [5, 1],
    [9, 100],
  ]) {
    const samples = frames(count, 60);
    const bytes = muxMp4({
      width: 640,
      height: 360,
      fps: 60,
      avcC: AVCC,
      samples,
      samplesPerChunk: perChunk,
    });
    const info = inspectMp4(bytes);
    assert.deepEqual(
      info.sizes,
      samples.map((s) => s.data.length),
    );
    // Expand stsc into "frames in chunk n", then walk the chunks.
    const runs = [];
    for (let i = 0; i < info.stsc.length; i += 3) runs.push(info.stsc.slice(i, i + 3));
    let frame = 0;
    info.offsets.forEach((offset, c) => {
      const run = runs.findLast(([first]) => first <= c + 1);
      let at = offset;
      for (let n = 0; n < run[1]; n++, frame++) {
        assert.ok(at >= info.mdat.start && at + info.sizes[frame] <= info.mdat.end, 'outside mdat');
        assert.deepEqual(
          bytes.subarray(at, at + info.sizes[frame]),
          samples[frame].data,
          `frame ${frame} of ${count} is not where the tables say`,
        );
        at += info.sizes[frame];
      }
    });
    assert.equal(frame, count, `the chunks hold ${frame} frames of ${count}`);
  }
});

test('the colour of the picture is written when it is known', () => {
  const colorSpace = { primaries: 1, transfer: 13, matrix: 5, fullRange: false };
  const bytes = file(60, 60, { colorSpace });
  const text = Buffer.from(bytes).toString('latin1');
  const at = text.indexOf('colrnclx');
  assert.ok(at > 0, 'no colr box');
  assert.deepEqual([...bytes.subarray(at + 8, at + 15)], [0, 1, 0, 13, 0, 5, 0]);
  assert.equal(Buffer.from(file(60)).toString('latin1').includes('colr'), false);
  // And it is still a file that reads back.
  assert.equal(inspectMp4(bytes).frames, 60);
});

test('it refuses what it cannot write truthfully', () => {
  const samples = frames(10, 60);
  const ok = { width: 640, height: 360, fps: 60, avcC: AVCC, samples };
  assert.throws(() => muxMp4({ ...ok, samples: [] }), /no frames/);
  assert.throws(() => muxMp4({ ...ok, samples: samples.slice(1) }), /not a key frame/);
  assert.throws(() => muxMp4({ ...ok, width: 641 }), /not even/);
  assert.throws(() => muxMp4({ ...ok, avcC: new Uint8Array(0) }), /no avcC/);
  assert.throws(() => inspectMp4(file().subarray(0, 500)), /runs off|no /);
});
