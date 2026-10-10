/**
 * Read the built site the way a visitor does, and photograph it on the way.
 *
 *   node site/capture.mjs                # measure only, write nothing
 *   node site/capture.mjs --out DIR      # + a full-page shot of every page
 *   node site/capture.mjs --out DIR --slices   # + each page cut into screens
 *
 * It builds the site into a temp directory, serves it from a socket the OS
 * chooses, under the path it is published at, drives one Chrome over the
 * DevTools Protocol, and takes the whole lot down again. Nothing is left
 * running and nothing is fetched from off the machine.
 *
 * Every page is opened at 1440, 768 and 390 CSS pixels and walked to the
 * bottom, so every lazy picture is asked for. At each size it reports what a
 * screenshot cannot show: an error on the console, a request that failed or
 * left the origin, a picture that did not arrive, a document wider than its
 * window. Then every page again at 360, for the width alone. A problem is a
 * non-zero exit, so this is a check as well as a camera.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { findChrome, hasWebSocket, withChrome } from '../src/cli/chrome.mjs';
import { PAGES } from './build.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const argv = process.argv.slice(2);
const outAt = argv.indexOf('--out');
const OUT_DIR = outAt !== -1 && argv[outAt + 1] ? path.resolve(argv[outAt + 1]) : '';
const SLICES = argv.includes('--slices');

const SIZES = [
  { width: 1440, height: 900 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/atom+xml; charset=utf-8',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (line) => process.stdout.write(`${line}\n`);

/** @param {string} dir @returns {Promise<{port:number, close:()=>Promise<void>}>} */
function serve(dir) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    let rel = decodeURIComponent(url.pathname).replace(/^\/(deckhq\/)?/, '');
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    let file = path.resolve(dir, rel);
    let status = 200;
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(dir, '404.html');
      status = 404;
    }
    res.writeHead(status, {
      'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
    });
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
 * Installed before any page script runs: every console error, every uncaught
 * exception and every element that failed to load its file, kept for the probe.
 */
const WATCH = `(() => {
  window.__problems = [];
  const note = (kind, text) => window.__problems.push(kind + ': ' + String(text).slice(0, 160));
  const error = console.error.bind(console);
  console.error = (...args) => { note('console', args.join(' ')); error(...args); };
  window.addEventListener('error', (event) => {
    const el = event.target;
    if (el && el !== window && (el.src || el.href)) note('failed', el.src || el.href);
    else note('exception', event.message);
  }, true);
  window.addEventListener('unhandledrejection', (event) => note('rejection', event.reason));
})()`;

/** Scroll to the bottom in steps so every lazy picture is asked for, then back. */
const WALK = `(async () => {
  document.documentElement.style.scrollBehavior = 'auto';
  const step = Math.round(innerHeight * 0.7);
  // Two painted frames at every stop, not a fixed wait: on a loaded machine a
  // timer can fire before the browser has looked at what scrolled into view,
  // and a lazy picture that was never looked at is never asked for.
  const painted = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  for (let y = 0; y < document.body.scrollHeight; y += step) {
    window.scrollTo(0, y);
    await painted();
    await new Promise((r) => setTimeout(r, 110));
  }
  window.scrollTo(0, document.body.scrollHeight);
  await painted();
  // Then every picture that was asked for gets the time to arrive.
  const pending = [...document.images].filter((i) => i.getClientRects().length && !i.complete);
  await Promise.race([
    Promise.all(pending.map((i) => new Promise((r) => {
      i.addEventListener('load', r);
      i.addEventListener('error', r);
    }))),
    new Promise((r) => setTimeout(r, 8000)),
  ]);
  window.scrollTo(0, 0);
  await new Promise((r) => setTimeout(r, 300));
  return document.documentElement.scrollHeight;
})()`;

const PROBE = `(() => {
  const d = document.documentElement;
  const over = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right > d.clientWidth + 1 && getComputedStyle(el).position !== 'fixed') {
      const clipped = el.closest('.table-scroll, .term, .cmd code');
      if (!clipped) over.push(el.tagName + '.' + String(el.className).slice(0, 30));
    }
  }
  const shown = [...document.images].filter((i) => i.getClientRects().length > 0);
  return JSON.stringify({
    scrollWidth: d.scrollWidth,
    clientWidth: d.clientWidth,
    over: over.slice(0, 5),
    h1: document.querySelectorAll('h1').length,
    broken: shown.filter((i) => !(i.complete && i.naturalWidth > 0)).map((i) => i.currentSrc),
    abroad: performance.getEntriesByType('resource').map((e) => e.name)
      .filter((name) => !name.startsWith(location.origin)),
    styled: getComputedStyle(document.body).backgroundColor,
    scripted: document.querySelectorAll('.cmd button').length,
    problems: window.__problems || [],
  });
})()`;

/** @param {any} client @param {{width:number,height:number}} size */
async function setSize(client, size) {
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: size.width,
    height: size.height,
    deviceScaleFactor: 1,
    mobile: size.width < 600,
  });
}

/** One PNG of a rectangle of the document. */
async function shoot(client, file, clip) {
  const { data } = await client.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { ...clip, scale: 1 },
  });
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
}

async function main() {
  if (!hasWebSocket()) throw new Error('Needs Node 22 or newer for its WebSocket client.');
  const chromePath = findChrome();
  if (!chromePath) throw new Error('No Chrome or Edge found. Set CHROME_PATH and try again.');

  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'deckhq-site-shot-'));
  const built = spawnSync(process.execPath, [path.join(here, 'build.mjs'), '--out', dist], {
    cwd: root,
    encoding: 'utf8',
  });
  if (built.status !== 0) throw new Error(`site build failed:\n${built.stderr}`);
  if (OUT_DIR) fs.mkdirSync(OUT_DIR, { recursive: true });

  const server = await serve(dist);
  const base = `http://127.0.0.1:${server.port}/deckhq/`;
  let failures = 0;
  const fail = (line) => {
    failures++;
    say(`  ! ${line}`);
  };

  try {
    await withChrome({ chromePath, width: 1440, height: 900, scale: 1 }, async (client) => {
      await client.send('Page.enable');
      await client.send('Page.addScriptToEvaluateOnNewDocument', { source: WATCH });
      const evaluate = async (expression) => {
        const { result } = await client.send('Runtime.evaluate', {
          expression,
          awaitPromise: true,
          returnByValue: true,
        });
        return result.value;
      };

      for (const page of PAGES) {
        const name = page.slug === 'index' ? 'home' : page.slug;
        for (const size of SIZES) {
          await setSize(client, size);
          await client.send('Page.navigate', { url: `${base}${page.slug}.html` });
          await sleep(900);
          const height = await evaluate(WALK);
          const probe = JSON.parse(await evaluate(PROBE));
          const where = `${name} at ${size.width}`;

          if (probe.scrollWidth > probe.clientWidth) {
            fail(`${where}: ${probe.scrollWidth} px wide (${probe.over.join(', ')})`);
          }
          if (probe.h1 !== 1) fail(`${where}: ${probe.h1} h1 elements`);
          for (const src of probe.broken) fail(`${where}: ${src} did not load`);
          for (const url of probe.abroad) fail(`${where}: fetched ${url}`);
          for (const problem of probe.problems) fail(`${where}: ${problem}`);
          if (probe.styled !== 'rgb(19, 20, 25)') fail(`${where}: the stylesheet did not apply`);
          if (page.slug === 'index' && probe.scripted === 0)
            fail(`${where}: the script did not run`);

          if (OUT_DIR) {
            const label = `${name}-${size.width}`;
            await shoot(client, path.join(OUT_DIR, `${label}.png`), {
              x: 0,
              y: 0,
              width: size.width,
              height,
            });
            if (SLICES) {
              const tall = size.height * 2;
              for (let y = 0, i = 1; y < height; y += tall, i++) {
                await shoot(
                  client,
                  path.join(OUT_DIR, `${label}-${String(i).padStart(2, '0')}.png`),
                  {
                    x: 0,
                    y,
                    width: size.width,
                    height: Math.min(tall, height - y),
                  },
                );
              }
            }
          }
          say(`${where.padEnd(22)} ${String(height).padStart(6)} px tall`);
        }

        // The narrowest phone still in use, for the width alone.
        await setSize(client, { width: 360, height: 760 });
        await client.send('Page.navigate', { url: `${base}${page.slug}.html` });
        await sleep(600);
        const narrow = JSON.parse(await evaluate(PROBE));
        if (narrow.scrollWidth > narrow.clientWidth) {
          fail(`${name} at 360: ${narrow.scrollWidth} px wide (${narrow.over.join(', ')})`);
        }
      }
    });
  } finally {
    await server.close();
    fs.rmSync(dist, { recursive: true, force: true });
  }

  if (failures) {
    say(`\n${failures} problem(s).`);
    process.exitCode = 1;
  } else {
    say(`\n${PAGES.length} pages at ${SIZES.length} sizes and at 360: no problems.`);
  }
}

await main();
