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
 *   - a loop is a GIF with its first frame beside it as a still, and a reader
 *     who asked for reduced motion is served the still;
 *   - every `<img>` leaves here with its own width and height, so nothing on a
 *     page moves while a picture arrives.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  loop: 3 * 1024 * 1024,
  /** A whole page read to the bottom on a dense screen, loops included. */
  page: { 'index.html': 2.5 * 1024 * 1024, default: 3 * 1024 * 1024 },
  /** What arrives before a reader scrolls: the document, its assets, the hero. */
  firstView: 600 * 1024,
};

/**
 * Pictures of something that is not released. They are not in the manifest,
 * because the free product cannot draw them, and they are the only pictures
 * allowed to be absent: a page wraps each in `<!-- if media/<file> -->` and
 * the block is dropped when the file is not there. Each must sit in a figure
 * whose caption carries the "Coming" tag.
 */
export const COMING = ['coming-office.png', 'coming-robot.png', 'coming-orbit.gif'];

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
    if (asset.kind === 'gif') names.add(`${asset.name}.gif`);
    else if (!asset.single) names.add(`${asset.name}@2x.png`);
  }
  return names;
}

/**
 * The pixel size of a PNG or a GIF, read out of its header.
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
  return null;
}

/** @param {string} tag @param {string} name */
const attr = (tag, name) => (tag.match(new RegExp(`\\s${name}="([^"]*)"`)) ?? [null, null])[1];

/** `media/hero.png` -> `media/hero@2x.png` */
const dense = (src) => src.replace(/\.png$/, '@2x.png');

/**
 * Drop every `<!-- if media/x -->…<!-- endif -->` block whose picture is not
 * in the repository, and the markers around the ones that stay.
 *
 * @param {string} body
 */
export function resolveOptional(body) {
  return body.replace(
    /[ \t]*<!-- if media\/([\w@.-]+) -->\n?([\s\S]*?)[ \t]*<!-- endif -->\n?/g,
    (_m, file, inner) => (fs.existsSync(path.join(MEDIA_DIR, file)) ? inner : ''),
  );
}

/**
 * Every `media/` file a page's markup names, in the order it names them.
 *
 * @param {string} html
 * @returns {string[]} paths relative to `media/`
 */
export function referencedMedia(html) {
  const seen = new Set();
  for (const m of html.matchAll(/(?:^|["\s,])media\/([\w@.-]+\.(?:png|gif))/g)) seen.add(m[1]);
  return [...seen];
}

/**
 * Copy the pictures the pages show into the built site, and nothing else.
 *
 * @param {string} outDir the built site
 * @param {string[]} files names relative to `media/`
 * @returns {{count: number, bytes: number, heaviest: {file: string, bytes: number}}}
 */
export function publishMedia(outDir, files) {
  const declared = declaredMedia();
  const wanted = new Set(files);
  // A still brings its dense sibling, and a loop brings its first frame.
  for (const file of files) {
    if (file.endsWith('.gif')) wanted.add(file.replace(/\.gif$/, '.png'));
    else if (declared.has(dense(file))) wanted.add(dense(file));
  }
  let bytes = 0;
  let heaviest = { file: '', bytes: 0 };
  fs.mkdirSync(path.join(outDir, 'media'), { recursive: true });
  for (const file of wanted) {
    if (!declared.has(file) && !COMING.includes(file) && !COMPOSED.includes(file)) {
      throw new Error(`media/${file} is shown on a page and is not declared in site/assets.json`);
    }
    const from = path.join(MEDIA_DIR, file);
    if (!fs.existsSync(from)) {
      throw new Error(`media/${file} is declared and not captured: run scripts/site-assets.mjs`);
    }
    const size = fs.statSync(from).size;
    const budget = file.endsWith('.gif') ? BUDGET.loop : BUDGET.still;
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
 * @param {string} body
 * @param {string} outDir where the pictures were copied to
 */
export function dressImages(body, outDir) {
  return body.replace(/<img\b[^>]*>/g, (tag) => {
    const src = attr(tag, 'src');
    if (!src || !src.startsWith('media/')) return tag;
    const size = imageSize(path.join(outDir, src));
    if (!size) throw new Error(`${src} is not a picture this build can measure`);
    let extra = '';
    if (!attr(tag, 'width')) extra += ` width="${size.width}" height="${size.height}"`;
    const pair = src.endsWith('.png') && fs.existsSync(path.join(outDir, dense(src)));
    if (pair && !attr(tag, 'srcset')) extra += ` srcset="${src} 1x, ${dense(src)} 2x"`;
    if (!/\sfetchpriority="high"/.test(tag) && !attr(tag, 'loading')) extra += ' loading="lazy"';
    if (!attr(tag, 'decoding')) extra += ' decoding="async"';
    const img = tag.replace(/\s*\/?>$/, `${extra} />`);
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
 * @param {{dpr?: 1|2, all?: boolean}} [opts]
 * @returns {number} bytes
 */
export function pageWeight(outDir, rel, opts = {}) {
  const { dpr = 2, all = true } = opts;
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
  return bytes;
}
