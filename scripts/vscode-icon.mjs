#!/usr/bin/env node
/**
 * Draw `vscode/media/icon.png` — the Marketplace and panel-tab icon.
 *
 *   node scripts/vscode-icon.mjs
 *
 * The mark is `▣`: the glyph the header numeral, `deckhq statusline` and the
 * VS Code status bar item all use, in the product's own palette — `--bg` for
 * the ground, `--ink` for the outline, `--accent` crimson for the fill. It is
 * drawn rather than cropped from a screenshot on purpose: at the 16 px the
 * Marketplace sidebar renders, a crop of the floor is mush, and this reads at
 * every size from a favicon to the extension page.
 *
 * Committed output, reproducible input. No dependency: the PNG encoder is the
 * one the goldens harness already carries (`scripts/lib/png.mjs`), and the
 * anti-aliasing is a 4× supersample with a box filter, which is all a shape
 * made of axis-aligned rectangles needs.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { encodePng } from './lib/png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SIZE = 256;
const SUPERSAMPLE = 4;

/** public/style.css, verbatim. */
const BG = [0x13, 0x14, 0x19, 0xff];
const INK = [0xec, 0xee, 0xf3, 0xff];
const ACCENT = [0xc0, 0x39, 0x2b, 0xff];

/** The mark, in fractions of the canvas. */
const OUTER = 0.16; // the outline's outer edge, inset from every side
const STROKE = 0.075; // the outline's thickness
const INNER = 0.365; // the filled square's edge

const S = SIZE * SUPERSAMPLE;
const big = new Uint8Array(S * S * 4);

/** @param {number} x @param {number} y @param {number[]} rgba */
function put(x, y, rgba) {
  const i = (y * S + x) * 4;
  big[i] = rgba[0];
  big[i + 1] = rgba[1];
  big[i + 2] = rgba[2];
  big[i + 3] = rgba[3];
}

/** @param {number} f0 @param {number} f1 @param {number[]} rgba */
function fill(f0, f1, rgba) {
  const a = Math.round(f0 * S);
  const b = Math.round(f1 * S);
  for (let y = a; y < b; y++) for (let x = a; x < b; x++) put(x, y, rgba);
}

// Ground, outline, hole, then the crimson centre. Four concentric squares is
// the whole drawing.
fill(0, 1, BG);
fill(OUTER, 1 - OUTER, INK);
fill(OUTER + STROKE, 1 - OUTER - STROKE, BG);
fill(INNER, 1 - INNER, ACCENT);

// Box-downsample.
const data = new Uint8Array(SIZE * SIZE * 4);
const n = SUPERSAMPLE * SUPERSAMPLE;
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    for (let dy = 0; dy < SUPERSAMPLE; dy++) {
      for (let dx = 0; dx < SUPERSAMPLE; dx++) {
        const i = ((y * SUPERSAMPLE + dy) * S + (x * SUPERSAMPLE + dx)) * 4;
        r += big[i];
        g += big[i + 1];
        b += big[i + 2];
        a += big[i + 3];
      }
    }
    const o = (y * SIZE + x) * 4;
    data[o] = Math.round(r / n);
    data[o + 1] = Math.round(g / n);
    data[o + 2] = Math.round(b / n);
    data[o + 3] = Math.round(a / n);
  }
}

const out = path.join(ROOT, 'vscode', 'media', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, encodePng({ width: SIZE, height: SIZE, data }));
process.stdout.write(`  ${out}  ${SIZE}×${SIZE}\n`);
