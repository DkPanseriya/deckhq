/**
 * WP-82 · one drawing, and everything that shows it.
 *
 * The mark is the only asset in this repository that a dozen unrelated
 * consumers read: a browser tab, a Windows taskbar button, a `.lnk`, a
 * Marketplace tile, the site, the npm page, and the header the product itself
 * draws. Each of those reads a DIFFERENT file, and every one of those files is
 * generated. That is exactly the shape of thing that rots quietly — someone
 * nudges the SVG, the PNGs stay behind, and the tab and the taskbar disagree
 * for a year.
 *
 * So the rule this file enforces is: **there is one source, and every byte
 * downstream of it is reproducible from it right now.**
 *
 *   1. the SVG is well-formed and carries nothing that could fetch, script or
 *      re-letter it;
 *   2. every consumer path exists and is not empty;
 *   3. the ICO parses, and its directory points inside itself;
 *   4. re-rendering the SVG reproduces every committed raster byte for byte;
 *   5. the copy inlined in the floor's header is the same geometry.
 *
 * (4) is a byte comparison and not a tolerance, and it needs no browser — see
 * the header of `scripts/brand/render-icons.mjs` for why the renderer is a
 * hundred lines of arithmetic rather than a screenshot.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readIco } from '../../src/core/ico.mjs';
import {
  ICO_SIZES,
  MARK_SVG,
  SIZES,
  VSCODE_ICON_SIZE,
  palettes,
  readMark,
  renderAll,
} from '../../scripts/brand/render-icons.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

const SVG = fs.readFileSync(MARK_SVG, 'utf8');

// ===========================================================================
// The source
// ===========================================================================

test('the mark is well-formed, square, and 512 on a side', () => {
  assert.match(SVG, /^<svg\b/, 'the file starts with the element, not with an editor preamble');
  assert.match(SVG.trimEnd(), /<\/svg>$/);
  assert.match(SVG, /viewBox="0 0 512 512"/);
  assert.match(SVG, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);

  // Every tag opened is closed, and nothing is left dangling. The mark's
  // subset is small enough that counting is a real check.
  const opens = SVG.match(/<[a-zA-Z][^>]*>/g) || [];
  const selfClosing = opens.filter((t) => t.endsWith('/>')).length;
  const closes = (SVG.match(/<\/[a-zA-Z]+>/g) || []).length;
  assert.equal(opens.length - selfClosing, closes, 'an element was opened and not closed');
});

test('the mark cannot fetch, script, or re-letter itself', () => {
  // Each of these would make the mark depend on something outside the file:
  // a font that is not on the machine, an image over the network, a script
  // that a static rasteriser cannot run. The whole point of a hand-written
  // mark is that `render-icons.mjs` can draw it with arithmetic.
  //
  // The SVG namespace is the one URL in the file and is not a fetch: it is a
  // name, and an SVG without it is not an SVG. It is removed before the scan
  // rather than carved out of the pattern, so a SECOND w3.org URL would still
  // be caught.
  const body = SVG.replace(/\s*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, '');
  for (const [pattern, why] of [
    [/<text\b/i, 'a <text> needs a font, and no two machines have the same one'],
    [/<image\b/i, 'an <image> is an external asset by definition'],
    [/xlink:href/i, 'xlink:href points out of the file'],
    [/\bhref\s*=/i, 'a reference out of the file'],
    [/<script\b/i, 'a mark does not execute'],
    [/<foreignObject\b/i, 'that is HTML, not a drawing'],
    [/url\(/i, 'no gradient, filter, pattern or external paint server'],
    [/@font-face/i, 'no font, embedded or otherwise'],
    [/\bdata:/i, 'no embedded blob'],
    [/https?:\/\//i, 'the free core reaches off this machine for nothing, the mark included'],
  ]) {
    assert.ok(!pattern.test(body), `public/brand/deckhq-mark.svg: ${why}`);
  }
});

test('the mark declares both grounds, with the same variables in each', () => {
  const p = palettes(SVG);
  assert.ok(p.dark, 'no svg.dark rule');
  assert.ok(p.light, 'no svg.light rule');
  assert.deepEqual(
    Object.keys(p.dark).sort(),
    Object.keys(p.light).sort(),
    'one ground declares a colour the other does not, so one of them draws a hole',
  );
  assert.match(SVG, /prefers-color-scheme:\s*light/, 'an unclassed copy must still follow the OS');
  for (const vars of [p.dark, p.light]) {
    for (const [name, value] of Object.entries(vars)) {
      assert.match(value, /^#[0-9a-fA-F]{6}$/, `${name} is not #rrggbb`);
    }
  }
});

test('every shape is a rounded rectangle, and every paint resolves', () => {
  const { shapes } = readMark(SVG);
  assert.ok(shapes.length >= 4, 'the mark lost shapes');
  const { dark, light } = palettes(SVG);
  for (const shape of shapes) {
    const name = shape.fill ?? shape.stroke;
    assert.ok(name, 'a shape with neither fill nor stroke draws nothing');
    assert.ok(dark[name], `the dark ground declares no ${name}`);
    assert.ok(light[name], `the light ground declares no ${name}`);
    assert.ok(shape.w > 0 && shape.h > 0, 'a zero-area shape');
  }
});

// ===========================================================================
// The consumers
// ===========================================================================

/** Every path something outside this repository reads the mark from. */
const CONSUMERS = [
  ...SIZES.map((s) => `public/icon-${s}.png`),
  'public/favicon.ico',
  'public/brand/deckhq-mark.svg',
  'vscode/media/icon.png',
];

for (const rel of CONSUMERS) {
  test(`${rel} exists and is not empty`, () => {
    const file = path.join(ROOT, rel);
    assert.ok(fs.existsSync(file), `${rel} is missing`);
    assert.ok(fs.statSync(file).size > 0, `${rel} is empty`);
  });
}

test('the manifest, the shortcut and the VS Code package all name a file that is there', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'public', 'manifest.webmanifest'), 'utf8'),
  );
  for (const icon of manifest.icons) {
    const file = path.join(ROOT, 'public', icon.src.replace(/^\.\//, ''));
    assert.ok(fs.existsSync(file), `the manifest names a missing ${icon.src}`);
  }
  // The mark fills 83% of its box, which is past a maskable icon's safe
  // circle: an Android launcher would crop the antenna off. `any` is the
  // honest declaration — see the header of the SVG.
  for (const icon of manifest.icons) {
    assert.equal(icon.purpose, 'any', 'this mark is not maskable and must not claim to be');
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vscode', 'package.json'), 'utf8'));
  assert.ok(fs.existsSync(path.join(ROOT, 'vscode', pkg.icon)));

  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  assert.match(html, /rel="icon" href="\.\/favicon\.ico"/, 'the floor does not link its ICO');
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.match(readme.split('\n')[0], /deckhq-mark\.svg/, 'the mark is not on the README');
});

test('the ICO parses, carries every small size, and points inside itself', () => {
  const bytes = fs.readFileSync(path.join(ROOT, 'public', 'favicon.ico'));
  const ico = readIco(bytes);
  assert.ok(ico, 'public/favicon.ico is not an ICO a reader accepts');
  assert.equal(ico.type, 1, 'type 1 = icon');
  assert.equal(ico.count, ICO_SIZES.length);
  assert.deepEqual(
    ico.entries.map((e) => e.width).sort((a, b) => a - b),
    [...ICO_SIZES].sort((a, b) => a - b),
  );
  for (const entry of ico.entries) {
    assert.equal(entry.width, entry.height, 'a non-square entry');
    assert.ok(entry.png, 'an entry that is not a PNG payload');
    assert.ok(entry.offset + entry.bytes <= bytes.length, 'an entry points past the end');
  }
});

// ===========================================================================
// The one that stops the drift
// ===========================================================================

test('every committed raster is what the SVG renders, byte for byte', () => {
  for (const [rel, bytes] of renderAll()) {
    const file = path.join(ROOT, rel);
    assert.ok(fs.existsSync(file), `${rel} was never written`);
    assert.deepEqual(
      fs.readFileSync(file),
      bytes,
      `${rel} is not what public/brand/deckhq-mark.svg renders today. ` +
        'Run `node scripts/brand/render-icons.mjs` and commit the result.',
    );
  }
});

test('the rasters cover every size the consumers ask for', () => {
  assert.ok(SIZES.includes(192), 'the manifest and the .lnk icon both name 192');
  assert.ok(SIZES.includes(512), 'Chrome offers Install only against a 512');
  assert.ok(SIZES.includes(VSCODE_ICON_SIZE), 'the Marketplace tile');
  for (const size of ICO_SIZES) assert.ok(SIZES.includes(size), `the ICO wants a ${size}`);
});

test('the header inlines the same drawing, shape for shape', () => {
  // index.html cannot use the file — an <img>-loaded SVG resolves
  // prefers-color-scheme against the OS, and all three DeckHQ themes are dark
  // — so it carries a copy whose paints are `--mark-*` variables. The copy is
  // allowed to differ in its COLOURS and in nothing else.
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const inline = /<svg class="brand-mark"[\s\S]*?<\/svg>/.exec(html);
  assert.ok(inline, 'the header has no inline mark');

  const withSourceNames = inline[0].replace(/var\(--mark-/g, 'var(--');
  const header = readMark(`<svg viewBox="0 0 512 512">${withSourceNames}</svg>`);
  const source = readMark(SVG);

  const geometry = (s) => s.shapes.map((p) => [p.x, p.y, p.w, p.h, p.r, p.strokeWidth]);
  assert.deepEqual(
    geometry(header),
    geometry(source),
    'the header mark and public/brand/deckhq-mark.svg have drifted apart',
  );
  assert.deepEqual(
    header.shapes.map((s) => [s.fill, s.stroke]),
    source.shapes.map((s) => [s.fill, s.stroke]),
    'the header paints a shape the source does not, or the other way round',
  );

  // And the stylesheet answers every variable the copy asks for.
  const css = fs.readFileSync(path.join(ROOT, 'public', 'style.css'), 'utf8');
  const block = /\.brand-mark\s*\{([\s\S]*?)\}/.exec(css);
  assert.ok(block, 'style.css has no .brand-mark rule');
  for (const m of inline[0].matchAll(/var\((--mark-[a-z-]+)\)/g)) {
    assert.ok(block[1].includes(`${m[1]}:`), `style.css never sets ${m[1]}`);
  }
});
