/**
 * Render the WP-87 / WP-89 motion mockups to PNG, and the crew GIF's frames.
 *
 * Doc-only tooling, kept beside the pages it renders, in the style of
 * `docs/media/design/character/`. It drives headless Chrome over the DevTools
 * protocol through `src/cli/chrome.mjs` — the same plumbing
 * `scripts/capture-floor.mjs` and `deckhq doctor --capture-proof` use — because
 * `--screenshot` waits for a page to go quiet and a canvas page never fires a
 * load event for its own drawing.
 *
 *   node docs/media/motion/render.mjs                     # the three PNGs
 *   node docs/media/motion/render.mjs --gif-frames <dir>  # crew.gif's frames
 *
 * No network, no assets, no libraries: every page is canvas 2D over
 * `docs/media/design/character/lib.js` plus `motion.js`.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { findChrome, pathToFileUrl, withChrome } from '../../../src/cli/chrome.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

/** The still pages: a file, its canvas size, and the scale to capture at. */
const PAGES = [
  { page: 'life-sheet.html', out: 'life-sheet.png', width: 1340, height: 1910, scale: 1.5 },
  { page: 'lounge.html', out: 'lounge-activities.png', width: 1320, height: 912, scale: 2 },
  { page: 'crew.html', out: 'crew.png', width: 1440, height: 900, scale: 1.75 },
];

/** How many frames the GIF is cut from, and how long one loop is. */
export const GIF_FRAMES = 30;
export const GIF_SECONDS = 2.5;

async function shot(client, url, outFile) {
  await client.send('Page.navigate', { url });
  // The page draws synchronously in its own inline script and sets
  // `data-done`; a fixed settle covers font metrics on a cold profile.
  await new Promise((r) => setTimeout(r, 700));
  const { data } = await client.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, Buffer.from(data, 'base64'));
  const kb = Math.round(fs.statSync(outFile).size / 1024);
  console.log(`${path.basename(outFile)}  ${kb} kB`);
}

async function main() {
  const chromePath = findChrome();
  if (!chromePath) throw new Error('No Chrome or Edge found');
  const gifDir = opt('--gif-frames', '');

  if (gifDir) {
    fs.mkdirSync(gifDir, { recursive: true });
    const frames = [];
    await withChrome({ chromePath, width: 760, height: 470, scale: 1 }, async (client) => {
      for (let i = 0; i < GIF_FRAMES; i++) {
        const t = (i / GIF_FRAMES) * GIF_SECONDS;
        const url = `${pathToFileUrl(path.join(HERE, 'crew.html'))}?mode=gif&p=${i / GIF_FRAMES}`;
        const file = path.join(gifDir, `f${String(i).padStart(3, '0')}.png`);
        await shot(client, url, file);
        frames.push({ file: path.basename(file), t });
      }
      fs.writeFileSync(
        path.join(gifDir, 'frames.json'),
        JSON.stringify({ width: 760, height: 470, frames }, null, 2),
      );
    });
    console.log(`${GIF_FRAMES} frames in ${gifDir}`);
    return;
  }

  const only = opt('--only', '');
  for (const p of PAGES) {
    if (only && !p.page.startsWith(only)) continue;
    await withChrome(
      { chromePath, width: p.width, height: p.height, scale: p.scale },
      async (client) => {
        await shot(client, pathToFileUrl(path.join(HERE, p.page)), path.join(HERE, p.out));
      },
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
