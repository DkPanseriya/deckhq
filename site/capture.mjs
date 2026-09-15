/**
 * Photograph the built site, and check it while the camera is there — WP-94c.
 *
 *   node site/capture.mjs                    # -> docs/media/site/*.png
 *   node site/capture.mjs --check            # measure only, write nothing
 *
 * Six shots: the home page at 375, 768 and 1440 CSS pixels, in the light
 * scheme and the dark one. They are `capture` class under `docs/MEDIA.md` §4.4
 * — a photograph of a real render of the real build, not a drawing.
 *
 * It builds the site into a temp directory, serves it from a socket the OS
 * chooses (`listen(0)`, the pattern the rest of this repository's tests use),
 * drives one Chrome over the DevTools Protocol, and takes the whole lot down
 * again. Nothing is left running and nothing is fetched from off the machine:
 * the only origin in play is `127.0.0.1` on a port that existed for a few
 * seconds.
 *
 * At each size it also measures what a screenshot cannot show: whether the
 * document is wider than its own viewport, whether the reveal resolved, and
 * whether the sticky bar is where it should be. Those come back on stdout and
 * a failure is a non-zero exit, so this is a check as well as a camera.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { findChrome, hasWebSocket, withChrome } from '../src/cli/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const argv = process.argv.slice(2);
const CHECK_ONLY = argv.includes('--check');
const OUT_DIR = path.join(root, 'docs', 'media', 'site');

/** The three widths, and the height a device of each is usually that tall. */
const SIZES = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
];

const SCHEMES = ['light', 'dark'];

/** Every page but the home page, for the overflow sweep at the end. */
const OTHER_PAGES = [
  'features.html',
  'look.html',
  'characters.html',
  'studio.html',
  'install.html',
  'docs.html',
  'model.html',
  'hooks-and-privacy.html',
  'adapters.html',
  'faq.html',
  'log/index.html',
  'log/1.html',
];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

/** @param {string} dir @returns {Promise<{port:number, close:()=>Promise<void>}>} */
function serve(dir) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(dir, rel);
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found\n');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        port: typeof address === 'object' && address ? address.port : 0,
        close: () => new Promise((done) => server.close(() => done(undefined))),
      });
    });
  });
}

/**
 * Walk the whole page the way a reader does, so the reveal actually fires and
 * every lazy image is asked for, then come back to the top for the shot. The
 * walk is instant rather than smooth: this is a camera, not a demonstration.
 */
const WALK = `(async () => {
  document.documentElement.style.scrollBehavior = 'auto';
  const step = Math.round(innerHeight * 0.8);
  for (let y = 0; y < document.body.scrollHeight; y += step) {
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 90));
  }
  window.scrollTo(0, document.body.scrollHeight);
  await new Promise((r) => setTimeout(r, 400));
  window.scrollTo(0, 0);
  await new Promise((r) => setTimeout(r, 400));
  return 'walked';
})()`;

/**
 * What a screenshot cannot show, read out of the page itself. Returned as
 * plain data so the caller can print it and decide.
 */
const PROBE = `(() => {
  const d = document.documentElement;
  const reveals = [...document.querySelectorAll('[data-reveal]')];
  const head = document.querySelector('.site-head');
  const over = [];
  for (const el of document.querySelectorAll('main *')) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && (r.right > d.clientWidth + 1 || r.left < -1)) {
      over.push(el.tagName + '.' + (el.className || '').toString().slice(0, 40));
    }
  }
  return JSON.stringify({
    scrollWidth: d.scrollWidth,
    clientWidth: d.clientWidth,
    overflowing: over.slice(0, 6),
    h1: document.querySelectorAll('h1').length,
    reveals: reveals.length,
    revealed: reveals.filter((e) => e.classList.contains('is-in')).length,
    firstRevealOpacity: reveals.length ? getComputedStyle(reveals[0]).opacity : null,
    headTop: head ? Math.round(head.getBoundingClientRect().top) : null,
    headSticky: head ? getComputedStyle(head).position : null,
    scheme: getComputedStyle(document.body).backgroundColor,
    toggleShown: !document.querySelector('.theme-toggle')?.hidden,
    imagesOk: [...document.images].every((i) => i.complete && i.naturalWidth > 0),
  });
})()`;

async function main() {
  if (!hasWebSocket()) throw new Error(`Needs Node 22 or newer for its WebSocket client.`);
  const chromePath = findChrome();
  if (!chromePath) throw new Error('No Chrome or Edge found. Set CHROME_PATH and try again.');

  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'deckhq-site-shot-'));
  const built = spawnSync(process.execPath, [path.join(here, 'build.mjs'), '--out', dist], {
    cwd: root,
    encoding: 'utf8',
  });
  if (built.status !== 0) throw new Error(`site build failed:\n${built.stderr}`);

  const server = await serve(dist);
  const url = `http://127.0.0.1:${server.port}/index.html`;
  let failures = 0;

  try {
    await withChrome({ chromePath, width: 1440, height: 900, scale: 1 }, async (client) => {
      for (const size of SIZES) {
        for (const scheme of SCHEMES) {
          await client.send('Emulation.setDeviceMetricsOverride', {
            width: size.width,
            height: size.height,
            deviceScaleFactor: 1,
            mobile: size.width < 600,
          });
          await client.send('Emulation.setEmulatedMedia', {
            features: [{ name: 'prefers-color-scheme', value: scheme }],
          });
          await client.send('Page.navigate', { url });
          // The page has no load event worth waiting for once the images are
          // cached, and it has an animated GIF below the fold that never lets
          // the renderer go idle. A fixed window is the honest way to wait.
          await new Promise((r) => setTimeout(r, 1800));

          await client.send('Runtime.evaluate', { expression: WALK, awaitPromise: true });

          const { result } = await client.send('Runtime.evaluate', {
            expression: PROBE,
            returnByValue: true,
          });
          const probe = JSON.parse(result.value);

          const problems = [];
          if (probe.scrollWidth > probe.clientWidth) {
            problems.push(
              `horizontal overflow: ${probe.scrollWidth} > ${probe.clientWidth}` +
                (probe.overflowing.length ? ` (${probe.overflowing.join(', ')})` : ''),
            );
          }
          if (probe.h1 !== 1) problems.push(`${probe.h1} h1 elements`);
          if (probe.revealed !== probe.reveals) {
            problems.push(`${probe.revealed} of ${probe.reveals} sections revealed after a walk`);
          }
          if (probe.firstRevealOpacity !== '1') {
            problems.push(`the first reveal is at opacity ${probe.firstRevealOpacity}`);
          }
          if (probe.headSticky !== 'sticky') problems.push(`the bar is ${probe.headSticky}`);
          if (!probe.toggleShown) problems.push('the scheme toggle stayed hidden');
          if (!probe.imagesOk) problems.push('an image did not load');

          const label = `home-${size.width}-${scheme}`;
          if (!CHECK_ONLY) {
            const { data } = await client.send('Page.captureScreenshot', {
              format: 'png',
              captureBeyondViewport: false,
            });
            fs.mkdirSync(OUT_DIR, { recursive: true });
            fs.writeFileSync(path.join(OUT_DIR, `${label}.png`), Buffer.from(data, 'base64'));
          }

          const kb = CHECK_ONLY
            ? ''
            : ` ${Math.round(fs.statSync(path.join(OUT_DIR, `${label}.png`)).size / 1024)} KB`;
          process.stdout.write(
            `${label.padEnd(20)} ${size.width}x${size.height} ${probe.scheme}` +
              ` ${probe.revealed}/${probe.reveals} revealed${kb}\n`,
          );
          for (const problem of problems) {
            failures++;
            process.stdout.write(`  ! ${problem}\n`);
          }
        }
      }

      // Reduced motion, at the widest. The reveal has to be off — not faster,
      // off — and every section has to be at full opacity from the first
      // frame, without anything having scrolled.
      await client.send('Emulation.setDeviceMetricsOverride', {
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await client.send('Emulation.setEmulatedMedia', {
        features: [
          { name: 'prefers-color-scheme', value: 'dark' },
          { name: 'prefers-reduced-motion', value: 'reduce' },
        ],
      });
      await client.send('Page.navigate', { url });
      await new Promise((r) => setTimeout(r, 1500));
      const { result: quiet } = await client.send('Runtime.evaluate', {
        expression: `JSON.stringify({
          hidden: [...document.querySelectorAll('[data-reveal]')]
            .filter((e) => getComputedStyle(e).opacity !== '1').length,
          marked: document.documentElement.classList.contains('js-reveal'),
        })`,
        returnByValue: true,
      });
      const motion = JSON.parse(quiet.value);
      if (motion.hidden > 0 || motion.marked) {
        failures++;
        process.stdout.write(
          `  ! under prefers-reduced-motion: ${motion.hidden} section(s) start hidden` +
            `${motion.marked ? ', and the reveal is still armed' : ''}\n`,
        );
      } else {
        process.stdout.write('reduced motion    every section visible, no reveal armed\n');
      }
      await client.send('Emulation.setEmulatedMedia', { features: [] });

      // Every other page, at the narrowest and the widest, for the one thing a
      // screenshot of the home page cannot tell you: whether some other page
      // is wider than the window it is read in.
      for (const slug of OTHER_PAGES) {
        for (const size of [SIZES[0], SIZES[2]]) {
          await client.send('Emulation.setDeviceMetricsOverride', {
            width: size.width,
            height: size.height,
            deviceScaleFactor: 1,
            mobile: size.width < 600,
          });
          await client.send('Page.navigate', {
            url: `http://127.0.0.1:${server.port}/${slug}`,
          });
          await new Promise((r) => setTimeout(r, 900));
          const { result } = await client.send('Runtime.evaluate', {
            expression: PROBE,
            returnByValue: true,
          });
          const probe = JSON.parse(result.value);
          if (probe.scrollWidth > probe.clientWidth || probe.h1 !== 1) {
            failures++;
            process.stdout.write(
              `  ! ${slug} at ${size.width}: ${probe.scrollWidth}/${probe.clientWidth} wide,` +
                ` ${probe.h1} h1` +
                (probe.overflowing.length ? ` (${probe.overflowing.join(', ')})` : '') +
                '\n',
            );
          }
        }
      }
      process.stdout.write(`${OTHER_PAGES.length} other pages measured at 375 and 1440\n`);
    });
  } finally {
    await server.close();
    fs.rmSync(dist, { recursive: true, force: true });
  }

  if (failures) {
    process.stdout.write(`\n${failures} problem(s).\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`\nsix shots, no problems.\n`);
  }
}

await main();
