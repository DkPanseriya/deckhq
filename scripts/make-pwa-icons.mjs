#!/usr/bin/env node
/**
 * The two PWA icons, drawn from the palette rather than from a design file.
 *
 *   node scripts/make-pwa-icons.mjs
 *
 * WP-16 needs a 192 and a 512 PNG for `public/manifest.webmanifest`, and this
 * project has no image pipeline, no CDN and no binary asset it did not
 * generate. So the icons are generated: a flat ground, a plate, and four desks
 * of which one is red. That is the product in one glyph — a floor, and one
 * thing waiting — and the colours are `public/style.css`'s own `--bg`,
 * `--surface-2`, `--ink-2` and `--accent`, so the icon cannot drift from the
 * chrome by hand-editing.
 *
 * The output is committed. This script exists so the next person can change
 * the mark without opening an editor, and so the icons are reproducible
 * (`--check` re-renders and compares, byte for byte).
 *
 * Encoder: `scripts/lib/png.mjs` over `node:zlib`. No dependency.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { encodePng } from './lib/png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');

/** public/style.css `:root`. Keep in step with it. */
const BG = [0x13, 0x14, 0x19, 0xff]; // --bg
const PLATE = [0x23, 0x26, 0x2f, 0xff]; // --surface-2
const DESK = [0xb8, 0xbd, 0xc9, 0xff]; // --ink-2
const WAITING = [0xc0, 0x39, 0x2b, 0xff]; // --accent, spent only on for_review

/**
 * A tiny painter. Everything is axis-aligned rounded rectangles with a
 * supersampled edge, which is all this mark needs and keeps the file honest
 * about having no graphics library.
 */
function image(size) {
  const data = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) data.set(BG, i * 4);
  return { width: size, height: size, data };
}

/**
 * Coverage of the pixel (px, py) by a rounded rectangle, sampled 4x4.
 * @returns {number} 0..1
 */
function coverage(px, py, x, y, w, h, r) {
  let hits = 0;
  for (let sy = 0; sy < 4; sy++) {
    for (let sx = 0; sx < 4; sx++) {
      const cx = px + (sx + 0.5) / 4;
      const cy = py + (sy + 0.5) / 4;
      if (cx < x || cy < y || cx > x + w || cy > y + h) continue;
      // Distance into the nearest corner's inset box.
      const dx = Math.max(x + r - cx, cx - (x + w - r), 0);
      const dy = Math.max(y + r - cy, cy - (y + h - r), 0);
      if (dx * dx + dy * dy <= r * r) hits++;
    }
  }
  return hits / 16;
}

function roundedRect(img, x, y, w, h, r, rgba) {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(img.width, Math.ceil(x + w));
  const y1 = Math.min(img.height, Math.ceil(y + h));
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const a = coverage(px, py, x, y, w, h, r);
      if (a <= 0) continue;
      const i = (py * img.width + px) * 4;
      for (let c = 0; c < 3; c++) {
        img.data[i + c] = Math.round(img.data[i + c] * (1 - a) + rgba[c] * a);
      }
      img.data[i + 3] = 255;
    }
  }
}

/**
 * The mark, at any size. Every dimension is a fraction of the canvas, and all
 * of it sits inside the central 62% — well inside a maskable icon's safe
 * circle, so the same file serves `purpose: "any maskable"`.
 * @param {number} size
 */
function drawIcon(size) {
  const img = image(size);
  const u = size / 100;

  // The floor plate.
  roundedRect(img, 19 * u, 19 * u, 62 * u, 62 * u, 10 * u, PLATE);

  // Four desks. Bottom right is the one waiting on you.
  const d = 21 * u;
  const gap = 8 * u;
  const left = 50 * u - d - gap / 2;
  const top = 50 * u - d - gap / 2;
  const r = 4 * u;
  roundedRect(img, left, top, d, d, r, DESK);
  roundedRect(img, left + d + gap, top, d, d, r, DESK);
  roundedRect(img, left, top + d + gap, d, d, r, DESK);
  roundedRect(img, left + d + gap, top + d + gap, d, d, r, WAITING);

  return img;
}

const SIZES = [192, 512];
const check = process.argv.includes('--check');
let failed = false;

for (const size of SIZES) {
  const file = path.join(PUBLIC, `icon-${size}.png`);
  const png = encodePng(drawIcon(size), { filter: 1 });
  if (check) {
    const existing = fs.existsSync(file) ? fs.readFileSync(file) : Buffer.alloc(0);
    const same = existing.equals(png);
    process.stdout.write(`${same ? 'ok  ' : 'DIFF'}  ${path.relative(ROOT, file)}\n`);
    if (!same) failed = true;
  } else {
    fs.writeFileSync(file, png);
    process.stdout.write(`wrote ${path.relative(ROOT, file)} (${png.length} bytes)\n`);
  }
}

if (failed) process.exitCode = 1;
