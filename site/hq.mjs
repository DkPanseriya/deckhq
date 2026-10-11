/**
 * THE 3D OFFICE AT FULL QUALITY: the clips at 2560 x 1440 and 3840 x 2160,
 * sixty frames a second, and the first frame of each as a picture.
 *
 * WHY THEY ARE NOT IN THE REPOSITORY. One clip is between 9 and 75 MB, and
 * every retake would add its weight to every clone for ever. So the files are
 * attached to a GitHub release of this repository (`tag` in the manifest) and
 * `site/3d-hq.json` lists each by name, size and SHA-256. The deploy fetches
 * them into `site/hq/` (ignored by git) with `scripts/site-hq.mjs fetch`,
 * which refuses a file whose hash is not the listed one, and the build copies
 * them into the site. They are then served from the site's own origin like
 * every other picture: a reader's browser asks nobody else for anything.
 *
 * ALL OR NOTHING. A build uses these files only when EVERY listed one is in
 * the folder at its listed size. A machine without them — a contributor's, or
 * CI's test job — builds the same pages with the 1280-pixel clips that are in
 * the repository, and nothing on a page points at a file that is not there.
 *
 * WHO IS SENT WHAT (`clipSources`), for a clip that has them:
 *
 *   a phone (under 40rem)            the 1280 x 720 clip in the repository
 *   everything wider                 2560 x 1440
 *   a clip shown in the wide stage,  3840 x 2160: the screens on which the
 *   on a dense wide screen           stage is more than 2560 device pixels
 *   whoever asked for less motion    no clip at all: the still
 *
 * and a reader whose browser is set to save data is stepped down to the 1280
 * clip by the page's script (`site.js`), which is why that source is last.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Where the files are kept on a machine that has them. Ignored by git. */
export const HQ_DIR = path.join(here, 'hq');
/** The list: `{ tag, files: [{ name, kind, width, height, bytes, sha256 }] }`. */
export const HQ_MANIFEST = path.join(here, '3d-hq.json');
/** Where the build puts them, under the site's root. */
export const HQ_OUT = 'media/3d/hq';
/** The repository whose release carries them. */
export const HQ_REPO = 'DkPanseriya/deckhq';

/**
 * What one may weigh, and all of them together. A 3840 x 2160 clip of ten
 * seconds measures 75 MB at the bitrate where a still frame of it is the
 * photographed frame; the set the 3D page shows measures 290 MB. GitHub Pages
 * serves a site of up to 1 GB.
 */
export const HQ_BUDGET = { file: 80 * 1024 * 1024, total: 400 * 1024 * 1024 };

/**
 * The screens on which the wide stage (`.shot--cinema`, up to 120rem) is more
 * than 2560 device pixels across, so the 3840 clip has pixels to show: a
 * window 1800 CSS pixels wide at one and a half device pixels to one, or 1400
 * wide at two to one.
 */
export const BIG = [
  '(min-width: 1800px) and (min-resolution: 1.5dppx)',
  '(min-width: 1400px) and (min-resolution: 2dppx)',
];

/** The room a picture in the wide stage has, for `sizes`. */
export const ROOM_CINEMA =
  '(min-width: 88rem) min(calc(100vw - 6rem), 120rem), (max-width: 76rem) 100vw, 76rem';

/** A name the release can carry unchanged: GitHub rewrites anything else. */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(mp4|png)$/;

/**
 * @typedef {{name: string, kind: 'clip' | 'still', width: number, height: number,
 *   bytes: number, sha256: string}} HqFile
 */

/**
 * The manifest, checked: a list that names a file twice, or by a name a
 * release would rewrite, or with no hash, is refused whole.
 *
 * @param {string} [file]
 * @returns {{tag: string, files: Map<string, HqFile>}}
 */
export function hqManifest(file = HQ_MANIFEST) {
  if (!fs.existsSync(file)) return { tag: '', files: new Map() };
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const files = new Map();
  for (const entry of raw.files ?? []) {
    if (!SAFE_NAME.test(entry.name))
      throw new Error(`3d-hq.json: ${entry.name} is not a safe name`);
    if (files.has(entry.name)) throw new Error(`3d-hq.json lists ${entry.name} twice`);
    if (!/^[0-9a-f]{64}$/.test(entry.sha256))
      throw new Error(`3d-hq.json: ${entry.name} has no hash`);
    if (!(entry.bytes > 0 && entry.width > 0 && entry.height > 0)) {
      throw new Error(`3d-hq.json: ${entry.name} has no size`);
    }
    if (entry.kind !== 'clip' && entry.kind !== 'still') {
      throw new Error(`3d-hq.json: ${entry.name} is neither a clip nor a still`);
    }
    files.set(entry.name, entry);
  }
  if (files.size && !/^[a-z0-9][a-z0-9.-]*$/.test(raw.tag ?? '')) {
    throw new Error('3d-hq.json names no release tag');
  }
  return { tag: raw.tag ?? '', files };
}

/**
 * The listed files this machine has — every one of them, or none. Sizes are
 * compared here; hashes are `fetch`'s and `check`'s to compare, once, when the
 * files arrive.
 *
 * @param {{dir?: string | null, manifest?: string}} [opts] `dir: null` is a
 *   build that is asked to do without them
 * @returns {Map<string, HqFile>}
 */
export function hqHave(opts = {}) {
  const dir = opts.dir === undefined ? HQ_DIR : opts.dir;
  if (!dir) return new Map();
  const { files } = hqManifest(opts.manifest);
  for (const entry of files.values()) {
    const file = path.join(dir, entry.name);
    if (!fs.existsSync(file) || fs.statSync(file).size !== entry.bytes) return new Map();
  }
  return files;
}

/**
 * What the full-quality set holds for one clip, as addresses a page can name.
 *
 * @param {string} clip `clip-rise`
 * @param {Map<string, HqFile>} have `hqHave()`
 * @returns {{mid: string | null, big: string | null,
 *   first: {src: string, width: number} | null}}
 */
export function hqClip(clip, have) {
  const address = (/** @type {string} */ name) => (have.has(name) ? `${HQ_OUT}/${name}` : null);
  let first = null;
  for (const entry of have.values()) {
    if (entry.kind === 'still' && entry.name.startsWith(`${clip}-first-`)) {
      if (!first || entry.width > first.width) {
        first = { src: `${HQ_OUT}/${entry.name}`, width: entry.width };
      }
    }
  }
  return { mid: address(`${clip}-1440.mp4`), big: address(`${clip}-2160.mp4`), first };
}

/**
 * The `<source>` elements of one clip of the 3D office, in the order a browser
 * tries them: it takes the first whose query holds.
 *
 * @param {object} o
 * @param {string} o.base the clip in the repository, `media/3d/clip-rise.mp4`
 * @param {string | null} o.mid its 2560 x 1440 file, when this build has it
 * @param {string | null} o.big its 3840 x 2160 file, when this build has it
 * @param {boolean} o.cinema shown in the wide stage
 * @param {string} o.narrow the query for a phone
 * @param {string} o.motion the query for a reader who did not ask for less motion
 * @returns {string}
 */
export function clipSources({ base, mid, big, cinema, narrow, motion }) {
  const source = (/** @type {string} */ src, /** @type {string} */ media, hq = false) =>
    `<source src="${src}" type="video/mp4" media="${media}"${hq ? ' data-hq' : ''} />`;
  const plain = source(base, motion);
  if (!mid) return plain;
  const dense =
    cinema && big ? source(big, BIG.map((q) => `${q} and ${motion}`).join(', '), true) : '';
  return source(base, `${narrow} and ${motion}`) + dense + source(mid, motion, true) + plain;
}

/**
 * Copy the full-quality files into the built site.
 *
 * @param {string} outDir
 * @param {Map<string, HqFile>} have
 * @param {string} [dir]
 * @returns {{count: number, bytes: number}}
 */
export function publishHq(outDir, have, dir = HQ_DIR) {
  let bytes = 0;
  if (!have.size) return { count: 0, bytes };
  fs.mkdirSync(path.join(outDir, HQ_OUT), { recursive: true });
  for (const entry of have.values()) {
    if (entry.bytes > HQ_BUDGET.file) {
      throw new Error(
        `${entry.name} is ${Math.round(entry.bytes / 1048576)} MB, over the ` +
          `${HQ_BUDGET.file / 1048576} MB a full-quality file may weigh`,
      );
    }
    fs.copyFileSync(path.join(dir, entry.name), path.join(outDir, HQ_OUT, entry.name));
    bytes += entry.bytes;
  }
  if (bytes > HQ_BUDGET.total) {
    throw new Error(
      `the full-quality files are ${Math.round(bytes / 1048576)} MB together, over ` +
        `${HQ_BUDGET.total / 1048576} MB`,
    );
  }
  return { count: have.size, bytes };
}

/** The SHA-256 of a file, read in pieces: one of these is 75 MB. @param {string} file */
export function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.allocUnsafe(1 << 20);
    for (;;) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!read) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

/** Where a release serves one of its files from. @param {string} tag @param {string} name */
export const releaseUrl = (tag, name) =>
  `https://github.com/${HQ_REPO}/releases/download/${tag}/${name}`;
