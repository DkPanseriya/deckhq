/**
 * Bring the finished pictures and clips of the 3D office into the site.
 *
 *   node scripts/site-3d-import.mjs --stills <folder> --clips <folder>
 *
 * The 3D office is not released and is not in this repository. What the site
 * shows of it is made somewhere else and arrives here as finished files: a
 * still is a `.png`, a clip is an `.mp4` with its first frame beside it as a
 * `.png` of the same name. This script takes the ones it knows by name out of
 * the two folders, writes them to `docs/media/site/3d/` under names that do
 * not change, and writes `site/3d-media.json`, the list `site/media.mjs`
 * publishes from. A page may show a 3D picture only if that list has it.
 *
 *   - a still is resampled to at most 2000 pixels wide and written as the
 *     pair the site's markup expects, `name.png` and `name@2x.png`, the first
 *     exactly half the second, each inside the site's 400 KB for a still;
 *   - a clip is copied byte for byte, and only if it is what the site plays:
 *     H.264 in a plain MP4 at sixty frames a second, no wider than 2000
 *     pixels, at most 1.6 MB. Its first frame becomes the pair it lies over;
 *   - a file that is neither a PNG nor an MP4 is refused, by its extension
 *     and by its first bytes, and so is a name this script does not know. A
 *     sheet of frames or a grid of poses is not on the list, so it is not on
 *     the site.
 *
 * A file a folder does not have is skipped and said so. Run it again when
 * more clips have arrived: what is already there is written again, the same.
 *
 * Dev script only: `scripts/` is not in the published package.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

import { inspectMp4 } from './lib/mp4-mux.mjs';
import { boxDownscale, decodePng } from './lib/png.mjs';
import { encodeIndexedPng, pngSize } from './lib/png-indexed.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = path.join(ROOT, 'docs', 'media', 'site', '3d');
export const MANIFEST = path.join(ROOT, 'site', '3d-media.json');

/** No 3D still on the public site is wider than this. */
export const MAX_WIDTH = 2000;
/** What a still may weigh, at either density: the site's own rule. */
export const STILL_BUDGET = 400 * 1024;
/** What a clip may weigh. */
export const CLIP_BUDGET = 1.6 * 1024 * 1024;

/** The stills: the approved file's name, and the name it has on the site. */
export const STILLS = [
  { from: 'pro3d.office.png', to: 'office' },
  { from: 'pro3d.states-stem.png', to: 'states' },
  { from: 'pro3d.hero-stem.png', to: 'stem' },
  { from: 'pro3d.hero-bale.png', to: 'bale' },
  { from: 'pro3d.hero-brick.png', to: 'brick' },
  { from: 'pro3d.hero-mote.png', to: 'mote' },
  { from: 'pro3d.night.png', to: 'night' },
  { from: 'pro3d.hand-up.png', to: 'hand-up' },
  { from: 'pro3d.panel.png', to: 'panel' },
];

/** The stills the home page shows small, in a row: `thumb-<name>`, 320 and 640 wide. */
export const THUMBS = ['office', 'stem', 'states', 'night'];
const THUMB_WIDTH = 640;

/** The clips: `<name>.mp4` and `<name>.png` in the folder, `clip-<name>` on the site. */
export const CLIPS = ['rise', 'walkthrough', 'states', 'stem', 'bale', 'brick', 'mote', 'orbit'];

/** The widths a dense still is tried at, widest first, until one fits the budget. */
const WIDTHS = [2000, 1920, 1760, 1600, 1440, 1280, 1120, 960, 800, 640];

/**
 * What a file is, by its name and by its first bytes, or a refusal.
 *
 * @param {string} name @param {Uint8Array} bytes
 * @returns {'png' | 'mp4'}
 */
export function kindOf(name, bytes) {
  const ext = path.extname(name).toLowerCase();
  const head = Buffer.from(bytes.subarray(0, 12));
  if (ext === '.png' && head.readUInt32BE(0) === 0x89504e47) return 'png';
  if (ext === '.mp4' && head.subarray(4, 8).toString('latin1') === 'ftyp') return 'mp4';
  throw new Error(`${name} is not a PNG or an MP4, and nothing else is taken`);
}

/**
 * A still as the pair the site serves: the widest dense file that fits the
 * budget, and the plain file at exactly half its width.
 *
 * @param {{width: number, height: number, data: Uint8Array}} img
 * @param {number[]} widths dense widths to try, widest first
 * @returns {{plain: Buffer, dense: Buffer}}
 */
export function stillPair(img, widths) {
  for (const width of new Set(widths.filter((w) => w <= img.width && w % 2 === 0))) {
    const at = width === img.width ? img : boxDownscale(img, width);
    const dense = encodeIndexedPng(at, 256, { dither: true });
    if (dense.length > STILL_BUDGET) continue;
    const plain = encodeIndexedPng(boxDownscale(img, width / 2), 256, { dither: true });
    return { plain, dense };
  }
  throw new Error('no width down to 640 pixels fits the budget for a still');
}

/**
 * Read a PNG into RGBA. `scripts/lib/png.mjs` reads truecolour; a first frame
 * written by `encodeIndexedPng` is against a palette with no scanline filter,
 * and that one shape is read here.
 *
 * @param {Buffer} bytes
 */
export function readPng(bytes) {
  if (bytes[25] !== 3) return decodePng(bytes);
  const { width, height } = pngSize(bytes);
  let palette = null;
  const idat = [];
  for (let pos = 8; pos + 8 <= bytes.length;) {
    const length = bytes.readUInt32BE(pos);
    const type = bytes.toString('latin1', pos + 4, pos + 8);
    if (type === 'PLTE') palette = bytes.subarray(pos + 8, pos + 8 + length);
    if (type === 'IDAT') idat.push(bytes.subarray(pos + 8, pos + 8 + length));
    pos += length + 12;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  if (bytes[24] !== 8 || !palette || raw.length !== (width + 1) * height) {
    throw new Error('a palette PNG of a shape this script does not read');
  }
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    if (raw[y * (width + 1)] !== 0) throw new Error('a palette PNG with a scanline filter');
    for (let x = 0; x < width; x++) {
      const slot = raw[y * (width + 1) + 1 + x] * 3;
      data.set([palette[slot], palette[slot + 1], palette[slot + 2], 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

/**
 * Whether a clip is one the site plays, and what it is. The reasons are the
 * rules `test/unit/site.test.mjs` holds every video on the site to.
 *
 * @param {string} name @param {Buffer} bytes
 */
export function checkClip(name, bytes) {
  kindOf(name, bytes);
  const info = inspectMp4(bytes);
  const refuse = (why) => {
    throw new Error(`${name}: ${why}`);
  };
  if (bytes.length > CLIP_BUDGET) refuse(`${Math.round(bytes.length / 1024)} KB, over 1.6 MB`);
  if (info.fragmented || info.top.join(' ') !== 'ftyp moov mdat') refuse('not a plain MP4');
  if (info.codec !== 'avc1') refuse(`${info.codec}, not H.264`);
  if (info.fps !== 60 || !info.constantRate) refuse(`${info.fps} frames a second, not 60`);
  if (info.frames < 120) refuse(`${info.frames} frames; it does not move`);
  if (info.width > MAX_WIDTH) refuse(`${info.width} pixels wide, over ${MAX_WIDTH}`);
  if (info.width % 2 || info.height % 2) refuse('an odd width or height');
  return info;
}

/**
 * A clip's first frame as the pair it lies over: the dense file the clip's
 * own size, so nothing moves when the clip takes over from it.
 *
 * @param {string} name @param {{width: number, height: number, data: Uint8Array}} img
 * @param {{width: number, height: number}} clip
 */
export function posterPair(name, img, clip) {
  const shape = (s) => s.width / s.height;
  if (img.width < clip.width || Math.abs(shape(img) / shape(clip) - 1) > 0.005) {
    throw new Error(`${name}: its first frame is ${img.width}x${img.height}, not the clip's shape`);
  }
  const at = img.width === clip.width ? img : boxDownscale(img, clip.width);
  if (at.height !== clip.height) throw new Error(`${name}: its first frame is another height`);
  const half = boxDownscale(img, clip.width / 2);
  for (const colours of [256, 128, 64, 32]) {
    const dense = encodeIndexedPng(at, colours, { dither: true });
    if (dense.length > STILL_BUDGET) continue;
    return { plain: encodeIndexedPng(half, colours, { dither: true }), dense };
  }
  throw new Error(`${name}: its first frame does not fit ${STILL_BUDGET / 1024} KB`);
}

/** Every file name this script can write: the only names the folder may hold. */
export function knownNames() {
  const pair = (name) => [`${name}.png`, `${name}@2x.png`];
  return new Set([
    ...STILLS.flatMap((s) => pair(s.to)),
    ...THUMBS.flatMap((name) => pair(`thumb-${name}`)),
    ...CLIPS.flatMap((name) => [...pair(`clip-${name}`), `clip-${name}.mp4`]),
  ]);
}

/**
 * The list the site publishes from: every file in the folder, with what it is
 * and what it measures. A file this script could not have written is refused.
 *
 * @param {string} dir
 */
export function manifestOf(dir) {
  const known = knownNames();
  const media = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (!known.has(name)) throw new Error(`${name} is in ${dir} and is not a name this writes`);
    const bytes = fs.readFileSync(path.join(dir, name));
    const clip = kindOf(name, bytes) === 'mp4';
    const { width, height } = clip ? inspectMp4(bytes) : pngSize(bytes);
    media.push({ name, kind: clip ? 'clip' : 'still', width, height, bytes: bytes.length });
  }
  return { media };
}

function main(argv) {
  const opt = (name) => {
    const i = argv.indexOf(name);
    return i !== -1 && argv[i + 1] ? argv[i + 1] : '';
  };
  const stills = opt('--stills');
  const clips = opt('--clips');
  const only = opt('--only') ? new Set(opt('--only').split(',')) : null;
  if (!stills && !clips) {
    throw new Error('usage: node scripts/site-3d-import.mjs --stills <folder> --clips <folder>');
  }
  const say = (line) => process.stdout.write(`${line}\n`);
  const kb = (bytes) => `${Math.round(bytes.length / 1024)} KB`;
  const put = (name, bytes) => fs.writeFileSync(path.join(OUT, name), bytes);
  const putPair = (name, pair) => {
    put(`${name}.png`, pair.plain);
    put(`${name}@2x.png`, pair.dense);
    const size = pngSize(pair.dense);
    say(
      `  ok   ${name.padEnd(18)} ${size.width}x${size.height}  ${kb(pair.plain)}, ${kb(pair.dense)}`,
    );
  };
  fs.mkdirSync(OUT, { recursive: true });

  for (const still of stills ? STILLS : []) {
    if (only && !only.has(still.to)) continue;
    const source = path.join(stills, still.from);
    if (!fs.existsSync(source)) {
      say(`  skip ${still.to.padEnd(18)} ${still.from} is not in the folder`);
      continue;
    }
    const bytes = fs.readFileSync(source);
    kindOf(still.from, bytes);
    const img = readPng(bytes);
    putPair(still.to, stillPair(img, [Math.min(img.width, MAX_WIDTH), ...WIDTHS]));
    if (THUMBS.includes(still.to)) putPair(`thumb-${still.to}`, stillPair(img, [THUMB_WIDTH]));
  }

  for (const name of clips ? CLIPS : []) {
    if (only && !only.has(`clip-${name}`)) continue;
    const video = path.join(clips, `${name}.mp4`);
    const frame = path.join(clips, `${name}.png`);
    if (!fs.existsSync(video) || !fs.existsSync(frame)) {
      say(
        `  skip ${`clip-${name}`.padEnd(18)} ${name}.mp4 and ${name}.png are not both in the folder`,
      );
      continue;
    }
    const bytes = fs.readFileSync(video);
    const info = checkClip(`${name}.mp4`, bytes);
    const first = fs.readFileSync(frame);
    kindOf(`${name}.png`, first);
    putPair(`clip-${name}`, posterPair(`${name}.png`, readPng(first), info));
    put(`clip-${name}.mp4`, bytes);
    say(
      `  ok   ${`clip-${name}.mp4`.padEnd(18)} ${info.width}x${info.height}  ${kb(bytes)}, copied`,
    );
  }

  const manifest = manifestOf(OUT);
  fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  const count = (kind) => manifest.media.filter((m) => m.kind === kind).length;
  say(`site/3d-media.json: ${count('still')} stills, ${count('clip')} clips`);
}

// Running the file imports; importing it, which is what the site's test does
// to exercise its refusals, does not.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
