/**
 * The pictures on the site: where they come from, what they may weigh, and
 * what the build writes around each one.
 *
 * Every picture is a capture of the running product against a fixture floor.
 * They are declared in `site/assets.json`, taken by `scripts/site-assets.mjs`
 * and kept in `docs/media/site/`. This file publishes the ones the pages show
 * and refuses the rest:
 *
 *   - a picture a page shows has to be one the manifest declares, so nothing
 *     drawn by hand can be published as a capture;
 *   - a still comes as a pair, `name.png` and `name@2x.png`, and the page gets
 *     a `srcset` naming both, so a dense screen is sharp and an ordinary one
 *     downloads half the pixels;
 *   - a still that can be drawn larger has a third file, `name@3x.png`, up to
 *     3840 pixels wide. It is offered by width, to screens wider than a phone,
 *     so only a screen with more than two device pixels to one is sent it;
 *   - a loop is a video at sixty frames a second, `name.mp4`, played over its
 *     own first frame, which is a still like any other. The still is what the
 *     page lays out, what a screen reader is told about, and all a reader who
 *     asked for reduced motion is ever sent;
 *   - every `<img>` leaves here with its own width and height, so nothing on a
 *     page moves while a picture arrives.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { inspectMp4 } from '../scripts/lib/mp4-mux.mjs';
import { largeWidth } from '../scripts/lib/site-still.mjs';
import { placeholderFor } from './placeholder.mjs';
import {
  BIG,
  HQ_BUDGET,
  HQ_OUT,
  ROOM_CINEMA,
  clipSources,
  hqClip,
  hqHave,
  hqStill,
  publishHq,
} from './hq.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

/** Where the captures live in the repository. */
export const MEDIA_DIR = path.join(root, 'docs', 'media', 'site');

/**
 * What a picture may weigh. A still is one file at one density; a loop is a
 * whole animation. Enforced here, so a build cannot publish a heavy picture,
 * and again in `test/unit/site.test.mjs`, which says which one and by how much.
 */
export const BUDGET = {
  still: 400 * 1024,
  /** A loop is a video now; the heaviest is under 600 KB. It was 3 MB, for GIFs. */
  loop: 1024 * 1024,
  /**
   * A whole page read to the bottom on a dense screen, loops included. The
   * home page was held to 2.5 MB while its two loops were GIFs at 25 frames a
   * second; as video at 60, twice as wide, it measures 2957 KB.
   */
  page: {
    'index.html': 3 * 1024 * 1024,
    /** The 3D page: up to ten stills at 400 KB and eight clips at 1.6 MB, every one lazy. */
    '3d.html': 16 * 1024 * 1024,
    default: 3 * 1024 * 1024,
  },
  /**
   * What arrives before a reader scrolls: the document, its assets, the hero's
   * first frame and the whole of the hero's video. It was 600 KB, when the
   * hero was a 385 KB GIF, 1140 pixels wide at 25 frames a second. The video
   * is 586 KB at 2400 pixels and 60 frames a second, which is as light as
   * Chrome's encoder makes it without softening it, and it measures 798 KB.
   * The picture is on the page sooner than it was: its first frame and
   * everything before it are 212 KB of that, and the video plays over it as
   * it arrives. It was 850 KB until 12 October 2026, when the 3D window went
   * to the top of the home page at the owner's instruction: its four pictures
   * (332 KB at the dense size) are now sent before a reader scrolls, and the
   * page measures 1137 KB. Whoever has asked for less motion is sent 551.
   */
  firstView: 1200 * 1024,
  /**
   * A clip of the 3D office: 1280 pixels wide at sixty frames a second, made
   * somewhere else and brought in finished. This build cannot make one
   * lighter, so the ceiling is what a clip of that size weighs. Three
   * megabytes since the ten-second walk-through, which was mush at 1.6: a clip
   * below the first screen is fetched only when it scrolls into view.
   */
  clip: 3 * 1024 * 1024,
  /**
   * The one clip that plays before a reader scrolls, on the 3D page. It is
   * sent to everybody who has not asked for less motion, so it keeps the
   * tighter ceiling.
   */
  clipFirst: 1.6 * 1024 * 1024,
  /**
   * The 3D page before a reader scrolls, without the clip its first picture
   * may play: the document, its assets and that picture. The clip is held to
   * `clip` above and arrives over the picture, which is on the page first.
   */
  firstView3d: 900 * 1024,
  /**
   * The typeface, which a screen 40rem and wider is sent on top of everything
   * above and a phone is not sent at all (`site/fonts.css`, linked with a
   * media query): the sheet and three WOFF2 files, 540 KB measured on
   * 11 October 2026. They are the files the product ships, unmodified, so
   * this build cannot make them lighter; the ceiling is what they weigh. The
   * words are on the page before any of it arrives (`font-display: swap`).
   */
  type: 560 * 1024,
};

export { BIG, HQ_BUDGET, HQ_OUT, ROOM_CINEMA, clipSources, hqClip, hqHave, publishHq };

/** Where the pictures of the 3D office sit, under `MEDIA_DIR` and under `media/`. */
export const DIR_3D = '3d';

/**
 * The pictures and clips of the 3D office, by file name, as
 * `scripts/site-3d-import.mjs` listed them in `site/3d-media.json`. The free
 * product cannot draw them, so they are not in `site/assets.json`; they are
 * made somewhere else and arrive here finished.
 *
 * @returns {Map<string, {name: string, kind: 'still' | 'clip', width: number, height: number, bytes: number}>}
 */
export function media3d() {
  const file = path.join(here, '3d-media.json');
  if (!fs.existsSync(file)) return new Map();
  return new Map(JSON.parse(fs.readFileSync(file, 'utf8')).media.map((m) => [m.name, m]));
}

/**
 * Pictures of something that is not released, as paths under `media/`. They
 * are the only pictures allowed to be absent: a page wraps one in
 * `<!-- if media/<file> -->` and the block is dropped when the file is not
 * there. Each must sit in a figure whose caption carries the "Coming" tag.
 */
export const COMING = [...media3d().keys()].map((name) => `${DIR_3D}/${name}`);

/** The room a 3D picture has when its page does not say: the column, or the window. */
export const ROOM_3D = '(max-width: 76rem) 100vw, 76rem';

/** `3d/office.png` -> true: a path under `media/` that is one of the 3D office's. */
const is3d = (file) => file.startsWith(`${DIR_3D}/`);

/**
 * The one composed picture: the card a link to the site unfurls into. It is
 * the mark, one line and a capture of the floor, brought in by
 * `scripts/site-import.mjs`, and it is shown on no page.
 */
export const COMPOSED = ['link-preview.png'];

/** The file names the manifest promises, with the stills' `@2x` siblings. */
export function declaredMedia() {
  const manifest = JSON.parse(fs.readFileSync(path.join(here, 'assets.json'), 'utf8'));
  const names = new Set();
  for (const asset of manifest.assets) {
    names.add(`${asset.name}.png`);
    if (!asset.single) names.add(`${asset.name}@2x.png`);
    if (largeWidth(asset)) names.add(`${asset.name}@3x.png`);
    if (asset.kind === 'loop') names.add(`${asset.name}.mp4`);
    if (asset.kind === 'loop' && asset.narrow) names.add(narrowOf(asset.name));
  }
  return names;
}

/**
 * `hero-walk` -> `hero-walk-narrow.mp4`: the same loop at the width the
 * manifest's `narrow` names, for a screen under 40rem. A phone draws the hero
 * 343 CSS pixels wide, which is 1029 of its own at three to one, and was sent
 * 2400.
 *
 * @param {string} name
 */
export const narrowOf = (name) => `${name}-narrow.mp4`;

/** The loops the manifest declares, by name: `hero-walk`, not a file. */
export function declaredLoops() {
  const manifest = JSON.parse(fs.readFileSync(path.join(here, 'assets.json'), 'utf8'));
  return new Set(manifest.assets.filter((a) => a.kind === 'loop').map((a) => a.name));
}

/**
 * The pixel size of a PNG, a GIF or an MP4, read out of the file itself.
 *
 * @param {string} file
 * @returns {{width: number, height: number} | null}
 */
export function imageSize(file) {
  let bytes;
  try {
    bytes = fs.readFileSync(file);
  } catch {
    return null;
  }
  const ext = path.extname(file).toLowerCase();
  if (ext === '.png' && bytes.length > 24 && bytes.readUInt32BE(0) === 0x89504e47) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (ext === '.gif' && bytes.length > 10 && bytes.subarray(0, 3).toString('latin1') === 'GIF') {
    return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  }
  if (ext === '.mp4') {
    try {
      const { width, height } = inspectMp4(bytes);
      return { width, height };
    } catch {
      return null;
    }
  }
  return null;
}

/** The width under which a page shows a picture's closer crop, where it has one. */
export const NARROW = '(max-width: 39.99rem)';

/** Everything wider than that: where a still's largest file may be offered. */
export const WIDE = '(min-width: 40rem)';

/** The readers a loop is played for: the ones who did not ask for less motion. */
export const MOTION = '(prefers-reduced-motion: no-preference)';

/** @param {string} tag @param {string} name */
const attr = (tag, name) => (tag.match(new RegExp(`\\s${name}="([^"]*)"`)) ?? [null, null])[1];

/** `media/hero.png` -> `media/hero@2x.png` */
const dense = (src) => src.replace(/\.png$/, '@2x.png');

/** `media/hero.png` -> `media/hero@3x.png`, the largest file a still can have. */
const large = (src) => src.replace(/\.png$/, '@3x.png');

/**
 * Drop every `<!-- if media/x -->…<!-- endif -->` block whose picture is not
 * in the repository, and the markers around the ones that stay.
 *
 * @param {string} body
 */
export function resolveOptional(body) {
  return body.replace(
    /[ \t]*<!-- if media\/([\w@./-]+) -->\n?([\s\S]*?)[ \t]*<!-- endif -->\n?/g,
    (_m, file, inner) => (fs.existsSync(path.join(MEDIA_DIR, file)) ? inner : ''),
  );
}

/**
 * A still of the 3D office that has a clip of the same thing names it:
 * `data-clip="clip-stem"`, with the words for it in `data-clip-alt`. When the
 * clip has been brought in, the picture becomes the clip's first frame, under
 * those words, and `dressImages` lays the clip over it. When it has not, the
 * still stays as it was written. Either way the two attributes are gone.
 *
 * @param {string} body
 * @param {Map<string, unknown>} [listed] `media3d()`
 */
export function resolveClips(body, listed = media3d()) {
  return body.replace(/<img\b[^>]*\sdata-clip="[^"]*"[^>]*>/g, (tag) => {
    const clip = attr(tag, 'data-clip');
    const words = attr(tag, 'data-clip-alt');
    const plain = tag.replace(/\s+data-clip(?:-alt)?="[^"]*"/g, '');
    if (!listed.has(`${clip}.mp4`)) return plain;
    if (!words) throw new Error(`${clip} is shown with no words of its own: data-clip-alt`);
    return plain
      .replace(/\ssrc="[^"]*"/, ` src="media/${DIR_3D}/${clip}.png"`)
      .replace(/\salt="[^"]*"/, ` alt="${words}"`);
  });
}

/**
 * Every `media/` file a page's markup names, in the order it names them.
 *
 * @param {string} html
 * @returns {string[]} paths relative to `media/`
 */
export function referencedMedia(html) {
  const seen = new Set();
  const named = /(?:^|["\s,])media\/((?:3d\/)?[\w@.-]+\.(?:png|gif|mp4))/g;
  for (const m of html.matchAll(named)) seen.add(m[1]);
  return [...seen];
}

/**
 * `media/hero-walk.png` -> `hero-walk`, when that is a loop the manifest
 * declares; `media/3d/clip-rise.png` -> `3d/clip-rise`, when that clip of the
 * 3D office has been brought in. The answer is a path under `media/`, less
 * its extension.
 *
 * @param {string} src @param {Set<string>} loops @param {Map<string, unknown>} listed
 */
const loopOf = (src, loops, listed) => {
  if (!src.endsWith('.png')) return null;
  const name = src.replace(/^media\//, '').replace(/\.png$/, '');
  if (is3d(name)) return listed.has(`${name.slice(DIR_3D.length + 1)}.mp4`) ? name : null;
  return loops.has(name) ? name : null;
};

/**
 * Copy the pictures the pages show into the built site, and nothing else.
 *
 * @param {string} outDir the built site
 * @param {string[]} files names relative to `media/`
 * @returns {{count: number, bytes: number, heaviest: {file: string, bytes: number}}}
 */
export function publishMedia(outDir, files) {
  const declared = declaredMedia();
  const loops = declaredLoops();
  const listed = media3d();
  // A picture of the 3D office is known by its own list, any other by the
  // manifest of captures.
  const known = (file) =>
    is3d(file) ? listed.has(file.slice(DIR_3D.length + 1)) : declared.has(file);
  const wanted = new Set(files);
  // A still brings its dense sibling, and a loop's still brings its video.
  for (const file of files) {
    if (file.endsWith('.gif')) wanted.add(file.replace(/\.gif$/, '.png'));
    else if (known(dense(file))) wanted.add(dense(file));
    if (declared.has(large(file))) wanted.add(large(file));
    const loop = loopOf(file, loops, listed);
    if (loop) wanted.add(`${loop}.mp4`);
    if (loop && declared.has(narrowOf(loop))) wanted.add(narrowOf(loop));
  }
  let bytes = 0;
  let heaviest = { file: '', bytes: 0 };
  fs.mkdirSync(path.join(outDir, 'media', DIR_3D), { recursive: true });
  for (const file of wanted) {
    if (!known(file) && !COMPOSED.includes(file)) {
      const list = is3d(file) ? 'listed in site/3d-media.json' : 'declared in site/assets.json';
      throw new Error(`media/${file} is shown on a page and is not ${list}`);
    }
    const from = path.join(MEDIA_DIR, file);
    if (!fs.existsSync(from)) {
      throw new Error(`media/${file} is declared and not captured: run scripts/site-assets.mjs`);
    }
    const size = fs.statSync(from).size;
    const moving = /\.(gif|mp4)$/.test(file);
    const budget = moving ? (is3d(file) ? BUDGET.clip : BUDGET.loop) : BUDGET.still;
    if (size > budget) {
      throw new Error(
        `media/${file} is ${Math.round(size / 1024)} KB, over the ` +
          `${Math.round(budget / 1024)} KB budget`,
      );
    }
    fs.copyFileSync(from, path.join(outDir, 'media', file));
    bytes += size;
    if (size > heaviest.bytes) heaviest = { file, bytes: size };
  }
  return { count: wanted.size, bytes, heaviest };
}

/**
 * Finish every `<img>` that shows a `media/` picture: its real width and
 * height, a `srcset` when the dense file exists, `decoding="async"`, and
 * `loading="lazy"` unless the page marked it `fetchpriority="high"`. A GIF is
 * wrapped so that reduced motion gets its first frame instead.
 *
 * Done here so the numbers are the file's own and the next page somebody
 * writes cannot forget them.
 *
 * And each gets a `ph-*` class naming the placeholder tone nearest its own
 * colour, so the box a lazy picture arrives into is not an empty dark one.
 *
 * A clip of the 3D office that this build has at full quality (`hq.mjs`) is
 * offered by screen: see `clipSources`. A page says a clip is shown in the
 * wide stage with `data-stage="cinema"` on its picture, which is what lets
 * the 3840-pixel file be offered at all.
 *
 * @param {string} body
 * @param {string} outDir where the pictures were copied to
 * @param {Record<string, [number, number, number]>} [tones] `placeholderTones()`
 * @param {Map<string, import('./hq.mjs').HqFile>} [have] `hqHave()`
 */
export function dressImages(body, outDir, tones = {}, have = new Map()) {
  const loops = declaredLoops();
  const listed = media3d();
  return body.replace(/<img\b[^>]*>/g, (tag) => {
    const src = attr(tag, 'src');
    if (!src || !src.startsWith('media/')) return tag;
    const size = imageSize(path.join(outDir, src));
    if (!size) throw new Error(`${src} is not a picture this build can measure`);
    let extra = '';
    // A loop is read by its first frame, which is the still beside it.
    const tone = placeholderFor(path.join(outDir, src.replace(/\.gif$/, '.png')), tones);
    if (tone && !attr(tag, 'class')) extra += ` class="ph-${tone}"`;
    if (!attr(tag, 'width')) extra += ` width="${size.width}" height="${size.height}"`;
    const pair = src.endsWith('.png') && fs.existsSync(path.join(outDir, dense(src)));
    // A picture of the 3D office is offered by width and not by density. Its
    // source is 1600 pixels wide and no file of it is wider than 2000, so its
    // plain file is narrower than the column it is shown in; named by width,
    // an ordinary screen takes the dense file where the room is that wide,
    // and a phone the plain one. `sizes` says how much room, and a page that
    // shows one narrower than the column says so itself.
    const cinema = attr(tag, 'data-stage') === 'cinema';
    if (pair && !attr(tag, 'srcset') && is3d(src.replace(/^media\//, ''))) {
      // A clip's first frame at full quality is one more width to choose from.
      const first = hqClip(path.basename(src, '.png'), have).first;
      const widest = first ? `, ${first.src} ${first.width}w` : '';
      extra += ` srcset="${src} ${size.width}w, ${dense(src)} ${size.width * 2}w${widest}"`;
      if (!attr(tag, 'sizes')) extra += ` sizes="${cinema ? ROOM_CINEMA : ROOM_3D}"`;
    } else if (pair && !attr(tag, 'srcset')) extra += ` srcset="${src} 1x, ${dense(src)} 2x"`;
    if (!/\sfetchpriority="high"/.test(tag) && !attr(tag, 'loading')) extra += ' loading="lazy"';
    if (!attr(tag, 'decoding')) extra += ' decoding="async"';
    const img = tag
      .replace(/\s+data-(?:narrow|stage)="[^"]*"/g, '')
      .replace(/\s*\/?>$/, `${extra} />`);
    // `data-narrow` names a closer crop of the same thing for a phone, where a
    // whole window would be a thumbnail. It becomes a `<source>` with its own
    // size, so the page holds the right room for whichever one is shown.
    const narrow = attr(tag, 'data-narrow');
    // The third file, for a screen wider than a phone with more than two
    // device pixels to one. Offered by width, so the browser picks the
    // smallest file that fills the room the picture has: `sizes` says that
    // room is the plain file's width, or the window when that is narrower.
    // Under 40rem this source does not apply and the `<img>` offers the pair
    // it always has, so a phone is never sent the largest file.
    const largest = pair ? large(src) : '';
    const big = largest && imageSize(path.join(outDir, largest));
    const wide = big
      ? `<source media="${WIDE}" srcset="${src} ${size.width}w, ${dense(src)} ${size.width * 2}w, ` +
        `${largest} ${big.width}w" sizes="(max-width: ${size.width}px) 100vw, ${size.width}px" ` +
        `width="${size.width}" height="${size.height}" />`
      : '';
    if (narrow) {
      const small = imageSize(path.join(outDir, narrow));
      if (!small) throw new Error(`${narrow} is not a picture this build can measure`);
      return (
        `<picture><source media="${NARROW}" srcset="${narrow} 1x, ${dense(narrow)} 2x" ` +
        `width="${small.width}" height="${small.height}" />${wide}${img}</picture>`
      );
    }
    if (wide) return `<picture>${wide}${img}</picture>`;
    const loop = loopOf(src, loops, listed);
    // A still of the 3D office this build has at full quality: every screen
    // wider than a phone is offered those files, by width, in place of the
    // 256-colour pair, which a phone still takes.
    const sharp =
      !loop && is3d(src.replace(/^media\//, '')) ? hqStill(path.basename(src, '.png'), have) : [];
    if (sharp.length) {
      const room = attr(tag, 'sizes') || (cinema ? ROOM_CINEMA : ROOM_3D);
      return (
        `<picture><source media="${WIDE}" srcset="` +
        sharp.map((s) => `${s.src} ${s.width}w`).join(', ') +
        `" sizes="${room}" width="${size.width}" height="${size.height}" />${img}</picture>`
      );
    }
    if (loop) {
      // The video is laid over its own first frame and takes no room of its
      // own, so the still is what holds the box, what is described, and what
      // is lazy. The first picture on a page plays at once; any other is
      // fetched and played by the script when it is scrolled to, because a
      // video with `autoplay` is fetched whole wherever on the page it is.
      // `media` on the source is the reduced-motion rule, in the markup: a
      // reader who asked for less is offered no source, so nothing is fetched
      // and the still is all there is.
      const video = imageSize(path.join(outDir, 'media', `${loop}.mp4`));
      if (!video) throw new Error(`media/${loop}.mp4 is not a video this build can measure`);
      const first = /\sfetchpriority="high"/.test(tag);
      // A loop with a narrow file offers it first, to a screen under 40rem; a
      // browser takes the first source whose query holds, so a phone is sent
      // that one and no other.
      const small = fs.existsSync(path.join(outDir, 'media', narrowOf(loop)))
        ? `<source src="media/${narrowOf(loop)}" type="video/mp4" ` +
          `media="${NARROW} and ${MOTION}" />`
        : '';
      // A clip of the 3D office this build has at full quality: by screen.
      const hq = is3d(loop) ? hqClip(loop.slice(DIR_3D.length + 1), have) : null;
      const sources = hq
        ? clipSources({
            base: `media/${loop}.mp4`,
            mid: hq.mid,
            big: hq.big,
            cinema,
            narrow: NARROW,
            motion: MOTION,
          })
        : `${small}<source src="media/${loop}.mp4" type="video/mp4" media="${MOTION}" />`;
      return (
        `<span class="loop">${img}<video${first ? ' autoplay' : ''} muted loop playsinline ` +
        `preload="${first ? 'metadata' : 'none'}" width="${video.width / 2}" ` +
        `height="${video.height / 2}" aria-hidden="true" tabindex="-1">${sources}</video></span>`
      );
    }
    if (!src.endsWith('.gif')) return img;
    const still = src.replace(/\.gif$/, '.png');
    return (
      `<picture><source media="(prefers-reduced-motion: reduce)" srcset="${still}" />` +
      `${img}</picture>`
    );
  });
}

/**
 * A picture of something unreleased says so where it is shown.
 *
 * @param {string} name the page, for the message
 * @param {string} body
 */
export function assertComingIsLabelled(name, body) {
  const labelled = new Set();
  for (const m of body.matchAll(/<figure[\s>][\s\S]*?<\/figure>/g)) {
    const caption = (m[0].match(/<figcaption[\s>]([\s\S]*?)<\/figcaption>/) ?? ['', ''])[1];
    if (!/class="tag tag--coming"/.test(caption)) continue;
    for (const file of referencedMedia(m[0])) labelled.add(file);
  }
  for (const file of referencedMedia(body)) {
    if (COMING.includes(file) && !labelled.has(file)) {
      throw new Error(`${name} shows media/${file} without a "Coming" tag in its caption`);
    }
  }
}

/**
 * What one page costs a reader on a screen of the given density.
 *
 * `all` is the page read to the bottom: the document, the stylesheet, the
 * script, the mark, and every picture, lazy ones and loops included. Without
 * it, only what is fetched before the reader scrolls. Of a `srcset` pair the
 * browser downloads one, so one is counted: the dense file at density 2.
 *
 * @param {string} outDir
 * @param {string} rel a page, e.g. `features.html`
 * @param {{dpr?: 1|2, all?: boolean, narrow?: boolean, videos?: boolean}} [opts] `narrow`: a
 *   screen under 40rem; `videos: false`: the page before any video, which is what a reader who
 *   asked for less motion is sent
 * @returns {number} bytes
 */
export function pageWeight(outDir, rel, opts = {}) {
  const { dpr = 2, all = true, videos = true } = opts;
  const file = path.join(outDir, rel);
  const html = fs.readFileSync(file, 'utf8');
  let bytes = Buffer.byteLength(html);
  for (const name of ['style.css', 'site.js', 'deckhq-mark.svg']) {
    const asset = path.join(outDir, name);
    if (fs.existsSync(asset)) bytes += fs.statSync(asset).size;
  }
  const seen = new Set();
  for (const [tag] of html.matchAll(/<img\b[^>]*>/g)) {
    if (!all && /loading="lazy"/.test(tag)) continue;
    let src = attr(tag, 'src');
    if (src && dpr === 2 && attr(tag, 'srcset')) src = dense(src);
    if (!src || seen.has(src)) continue;
    seen.add(src);
    const image = path.resolve(path.dirname(file), src);
    if (fs.existsSync(image)) bytes += fs.statSync(image).size;
  }
  // A video is counted whole: one with `autoplay` is fetched to its last byte
  // as soon as the page is, and any other when the reader scrolls to it. Of
  // two sources one is fetched: the narrow file on a phone, the other on
  // every wider screen.
  if (!videos) return bytes;
  for (const [, tag, inner] of html.matchAll(/(<video\b[^>]*>)([\s\S]*?)<\/video>/g)) {
    // The full-quality sources are not counted: they are sent only to a wide
    // screen on a connection that can carry them, and weigh megabytes each by
    // design. What is counted is the page as a phone, a slow connection and a
    // build without those files are sent it; `HQ_BUDGET` holds the rest.
    const sources = [...inner.matchAll(/<source\b[^>]*\ssrc="([^"]+)"[^>]*>/g)].filter(
      (s) => !/\sdata-hq\b/.test(s[0]),
    );
    const pick = sources.find((s) => /max-width/.test(s[0]) === Boolean(opts.narrow));
    const src = (pick ?? sources[sources.length - 1] ?? [])[1];
    if (!src || (!all && !/\sautoplay[\s>]/.test(tag)) || seen.has(src)) continue;
    seen.add(src);
    const video = path.resolve(path.dirname(file), src);
    if (fs.existsSync(video)) bytes += fs.statSync(video).size;
  }
  return bytes;
}
