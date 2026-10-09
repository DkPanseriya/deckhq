/**
 * Bring in the few pictures the site shows that `scripts/site-assets.mjs`
 * cannot take from the free product.
 *
 *   node scripts/site-import.mjs <folder>
 *
 * There are two kinds, and `site/media.mjs` lists both by name:
 *
 *   - the card a link to the site unfurls into, 1200 x 630, which is a
 *     composed image (the mark, one line, a capture of the floor) rather than
 *     a capture on its own;
 *   - pictures of the 3D office, which is not released. Each one carries the
 *     word "Coming" in the picture itself and again in its caption, and a page
 *     that shows one is built without it when the file is absent.
 *
 * Every file is resampled to the width the site shows it at and written
 * against a 256-colour palette, dithered, because these are shaded renders
 * rather than flat drawings. A file the folder does not have is skipped and
 * said so; nothing is invented in its place.
 *
 * Dev script only: `scripts/` is not in the published package.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { boxDownscale, decodePng } from './lib/png.mjs';
import { encodeIndexedPng } from './lib/png-indexed.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'media', 'site');

/** What to look for in the folder, and what it becomes on the site. */
const IMPORTS = [
  { from: 'link-preview-1200x630.png', to: 'link-preview.png', width: 1200, dither: false },
  { from: 'pro3d.office.png', to: 'coming-office.png', width: 1280, dither: true },
  { from: 'pro3d.hero-stem.png', to: 'coming-robot.png', width: 960, dither: true },
  { from: 'pro3d.orbit.gif', to: 'coming-orbit.gif' },
];

/** What `site/media.mjs` lets a loop weigh. */
const LOOP_BUDGET = 3 * 1024 * 1024;

const folder = process.argv[2];
if (!folder) throw new Error('usage: node scripts/site-import.mjs <folder>');

const say = (line) => process.stdout.write(`${line}\n`);
fs.mkdirSync(OUT, { recursive: true });

for (const item of IMPORTS) {
  const source = path.join(folder, item.from);
  if (!fs.existsSync(source)) {
    say(`  skip ${item.from.padEnd(28)} not in the folder`);
    continue;
  }
  const bytes = fs.readFileSync(source);
  if (item.to.endsWith('.gif')) {
    // A loop is copied as it is or not at all: there is no GIF decoder here
    // to make a heavy one lighter, and the site's budget for a loop is 3 MB.
    if (bytes.length > LOOP_BUDGET) {
      say(`  skip ${item.from.padEnd(28)} ${(bytes.length / 1024).toFixed(0)} KB, over 3 MB`);
      continue;
    }
    fs.writeFileSync(path.join(OUT, item.to), bytes);
    say(`  ok   ${item.to.padEnd(28)} ${(bytes.length / 1024).toFixed(0)} KB, copied`);
    continue;
  }
  let img = decodePng(bytes);
  if (img.width > item.width) img = boxDownscale(img, item.width);
  const out = encodeIndexedPng(img, 256, { dither: item.dither });
  fs.writeFileSync(path.join(OUT, item.to), out);
  say(
    `  ok   ${item.to.padEnd(28)} ${img.width}x${img.height}  ` +
      `${(out.length / 1024).toFixed(0)} KB`,
  );
}
