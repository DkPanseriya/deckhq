#!/usr/bin/env node
/**
 * Every raster the mark has, from the one SVG that is the mark — WP-82.
 *
 *   node scripts/brand/render-icons.mjs            # write them
 *   node scripts/brand/render-icons.mjs --check    # re-render and compare, exit 1 on a difference
 *
 * ## Why this does not drive a browser
 *
 * `scripts/capture-floor.mjs` and `scripts/goldens.mjs` photograph the floor
 * through headless Chrome because the floor is a running program. An icon is
 * not: `public/brand/deckhq-mark.svg` is six axis-aligned rounded rectangles
 * over a transparent ground, and Chrome would buy nothing for it but a
 * dependency on a browser version. Worse, it would buy a **liability** — two
 * Chromes anti-alias a curve differently, so a committed PNG could only ever be
 * compared against a fresh render with a pixel tolerance, on the machine that
 * happened to bake it. The goldens live with that (they are per platform for
 * exactly this reason); an icon must not.
 *
 * So this file rasterises the SVG itself. `Math.sqrt` is IEEE-754 exact and
 * everything else here is add and multiply, which makes the output **byte for
 * byte identical on every machine and every Node**, and lets
 * `test/unit/brand-mark.test.mjs` assert the committed bytes rather than
 * approximate them, on every machine rather than only where Chrome is.
 *
 * It is not a general SVG renderer and must never become one. It reads the one
 * subset the mark is written in — `<rect>`, `<circle>`, `fill`, `stroke`,
 * `stroke-width`, `rx`, and `var(--name)` resolved against the `svg.dark` /
 * `svg.light` rules in the file's own `<style>`. Anything else in the file is
 * an error rather than something silently skipped, because a shape that did not
 * draw is a mark that shipped wrong.
 *
 * Anti-aliasing is the signed distance to the rounded rectangle, sampled once
 * at each pixel centre and clamped to a one-pixel ramp — the standard analytic
 * edge, and a better one at 16 px than a 4x4 box filter, which is what the two
 * scripts this replaces used.
 *
 * The PNG encoder is `scripts/lib/png.mjs` and the ICO wrapper is
 * `src/core/ico.mjs`, both already in the tree. No dependency, at build time or
 * at run time.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { encodePng } from '../lib/png.mjs';
import { pngToIco } from '../../src/core/ico.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../..');

/** The one source. Everything below is a rasterisation of this file. */
export const MARK_SVG = path.join(ROOT, 'public', 'brand', 'deckhq-mark.svg');

/**
 * The sizes written as `public/icon-<n>.png`.
 *
 * 16/32/48 are what a taskbar, a tab strip and an Explorer list ask for; 64,
 * 128 and 256 are the Windows shell's larger rungs and the Marketplace tile;
 * 512 is what Chrome requires before it offers Install at all. 192 is not a
 * rung anyone asks for by name — it is here because `manifest.webmanifest` and
 * `src/core/launcher-apply.mjs`'s `ICON_PNGS` already name it, and the `.lnk`
 * icon declares it exactly rather than through the ICO format's "256 or
 * larger" sentinel (`src/core/ico.mjs`).
 */
export const SIZES = [16, 32, 48, 64, 128, 192, 256, 512];

/** The sizes that go into `public/favicon.ico`. 512 is dead weight in an ICO. */
export const ICO_SIZES = [16, 32, 48, 64, 128, 256];

/**
 * The ground the raster set is baked on.
 *
 * The mark's own README: *"Dark variant is the stronger; light-on-light depends
 * on its rim."* A PNG cannot follow `prefers-color-scheme`, and an icon that
 * carries its own dark plate reads on a light taskbar and a dark one alike, so
 * there is one raster set and it is the dark one. The light variant is reachable
 * — it is in the SVG, and `--variant light` renders it — and nothing in the
 * repository ships it.
 */
export const RASTER_VARIANT = 'dark';

/** `128`, because that is the tile the VS Code Marketplace draws. */
export const VSCODE_ICON_SIZE = 128;

// ===========================================================================
// Reading the mark
// ===========================================================================

/** Every attribute of one tag, as a map. @param {string} tag */
function attrs(tag) {
  /** @type {Record<string,string>} */
  const out = {};
  for (const m of tag.matchAll(/([a-zA-Z-]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

/** @param {Record<string,string>} a @param {string} name @param {number} [fallback] */
function num(a, name, fallback = 0) {
  const raw = a[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${name}="${raw}" is not a number`);
  return n;
}

/**
 * `#rrggbb` as four 0..255 channels.
 * @param {string} hex
 * @returns {[number,number,number,number]}
 */
function rgba(hex) {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff, 255];
}

/**
 * The palettes the file declares, by variant name.
 *
 * Read from the `svg.dark { ... }` / `svg.light { ... }` rules rather than
 * restated here, so a colour can be changed in one place and only one place.
 *
 * @param {string} src
 * @returns {Record<string, Record<string,string>>}
 */
export function palettes(src) {
  /** @type {Record<string, Record<string,string>>} */
  const out = {};
  for (const m of src.matchAll(/svg\.([a-z]+)\s*\{([^}]*)\}/g)) {
    /** @type {Record<string,string>} */
    const vars = {};
    for (const decl of m[2].matchAll(/(--[a-z-]+)\s*:\s*(#[0-9a-fA-F]{6})/g)) {
      vars[decl[1]] = decl[2];
    }
    out[m[1]] = vars;
  }
  return out;
}

/**
 * @typedef {{x:number, y:number, w:number, h:number, r:number,
 *            fill:string|null, stroke:string|null, strokeWidth:number}} Shape
 */

/**
 * The mark as shapes, in paint order, with `fill`/`stroke` left as the
 * `--name` they reference.
 *
 * A circle is emitted as the rounded rectangle it is. Every other tag in the
 * file — `<svg>`, `<title>`, `<style>` — is known and skipped; a tag that is
 * neither is thrown on.
 *
 * @param {string} src
 * @returns {{viewBox:[number,number,number,number], shapes:Shape[]}}
 */
export function readMark(src) {
  const body = src.replace(/<!--[\s\S]*?-->/g, '').replace(/<style[\s\S]*?<\/style>/g, '');

  const vb = /viewBox="([^"]+)"/.exec(src);
  if (!vb) throw new Error('the mark has no viewBox');
  const box = vb[1].trim().split(/\s+/).map(Number);
  if (box.length !== 4 || box.some((n) => !Number.isFinite(n))) {
    throw new Error(`unreadable viewBox: ${vb[1]}`);
  }

  /** `var(--name)`, `none`, or nothing. @param {string|undefined} raw */
  const paint = (raw) => {
    if (raw === undefined || raw === 'none') return null;
    const m = /^var\((--[a-z-]+)\)$/.exec(raw.trim());
    if (!m) throw new Error(`a paint that is not var(--name) or none: ${raw}`);
    return m[1];
  };

  /** @type {Shape[]} */
  const shapes = [];
  for (const m of body.matchAll(/<([a-zA-Z]+)\b([^>]*)>/g)) {
    const [, name, rest] = m;
    if (name === 'svg' || name === 'title' || name === 'style') continue;
    const a = attrs(rest);
    if (name === 'rect') {
      const w = num(a, 'width');
      const h = num(a, 'height');
      shapes.push({
        x: num(a, 'x'),
        y: num(a, 'y'),
        w,
        h,
        r: Math.min(num(a, 'rx'), w / 2, h / 2),
        fill: paint(a.fill),
        stroke: paint(a.stroke),
        strokeWidth: num(a, 'stroke-width'),
      });
    } else if (name === 'circle') {
      const r = num(a, 'r');
      shapes.push({
        x: num(a, 'cx') - r,
        y: num(a, 'cy') - r,
        w: r * 2,
        h: r * 2,
        r,
        fill: paint(a.fill),
        stroke: paint(a.stroke),
        strokeWidth: num(a, 'stroke-width'),
      });
    } else {
      throw new Error(
        `<${name}> is not in the subset this renderer reads. The mark is rounded ` +
          `rectangles on purpose (see the header of this file and of the SVG).`,
      );
    }
  }
  if (shapes.length === 0) throw new Error('the mark drew nothing');
  return { viewBox: /** @type {[number,number,number,number]} */ (box), shapes };
}

// ===========================================================================
// Rasterising
// ===========================================================================

/**
 * Signed distance from a point to a rounded rectangle: negative inside,
 * positive outside, in the same units as the rectangle.
 *
 * @param {number} px @param {number} py
 * @param {number} cx @param {number} cy half-extent centre
 * @param {number} hx @param {number} hy half-extents
 * @param {number} r corner radius
 */
function sdRoundRect(px, py, cx, cy, hx, hy, r) {
  const qx = Math.abs(px - cx) - (hx - r);
  const qy = Math.abs(py - cy) - (hy - r);
  const outX = Math.max(qx, 0);
  const outY = Math.max(qy, 0);
  return Math.min(Math.max(qx, qy), 0) + Math.sqrt(outX * outX + outY * outY) - r;
}

/**
 * The mark at `size`x`size`, RGBA, transparent outside the plate's corners.
 *
 * Shapes are composited in document order with straight-alpha "over". A shape
 * with a stroke and no fill is drawn as the ring between two rounded
 * rectangles, which is what SVG's centred stroke means for this geometry.
 *
 * @param {number} size
 * @param {{src?:string, variant?:string}} [opts]
 * @returns {{width:number, height:number, data:Uint8Array}}
 */
export function renderMark(size, opts = {}) {
  const src = opts.src ?? fs.readFileSync(MARK_SVG, 'utf8');
  const variant = opts.variant ?? RASTER_VARIANT;
  const { viewBox, shapes } = readMark(src);
  const vars = palettes(src)[variant];
  if (!vars) throw new Error(`the mark declares no "${variant}" variant`);

  const [, , vw, vh] = viewBox;
  const k = size / vw;
  if (vw !== vh) throw new Error('the mark is square; this renderer assumes it');

  // Premultiplied float RGBA, so "over" is one multiply-add per channel and
  // the rounding happens once, at the end.
  const acc = new Float64Array(size * size * 4);

  for (const shape of shapes) {
    const name = shape.fill ?? shape.stroke;
    if (!name) continue;
    const colour = vars[name];
    if (!colour) throw new Error(`the ${variant} variant declares no ${name}`);
    const [sr, sg, sb] = rgba(colour);

    const ring = shape.fill === null && shape.stroke !== null;
    const sw = shape.strokeWidth;
    // In device pixels: the rectangle, and for a ring the outer and inner
    // edges the centred stroke runs between.
    const cx = (shape.x + shape.w / 2) * k;
    const cy = (shape.y + shape.h / 2) * k;
    const hx = (shape.w / 2 + (ring ? sw / 2 : 0)) * k;
    const hy = (shape.h / 2 + (ring ? sw / 2 : 0)) * k;
    const rr = (shape.r + (ring ? sw / 2 : 0)) * k;
    const ihx = (shape.w / 2 - sw / 2) * k;
    const ihy = (shape.h / 2 - sw / 2) * k;
    const irr = Math.max(0, (shape.r - sw / 2) * k);

    // Only the pixels the shape can reach, plus one for the AA ramp.
    const x0 = Math.max(0, Math.floor(cx - hx - 1));
    const x1 = Math.min(size, Math.ceil(cx + hx + 1));
    const y0 = Math.max(0, Math.floor(cy - hy - 1));
    const y1 = Math.min(size, Math.ceil(cy + hy + 1));

    for (let py = y0; py < y1; py++) {
      const sy = py + 0.5;
      for (let px = x0; px < x1; px++) {
        const sx = px + 0.5;
        let d = sdRoundRect(sx, sy, cx, cy, hx, hy, rr);
        if (ring) d = Math.max(d, -sdRoundRect(sx, sy, cx, cy, ihx, ihy, irr));
        const a = Math.min(1, Math.max(0, 0.5 - d));
        if (a <= 0) continue;
        const i = (py * size + px) * 4;
        const inv = 1 - a;
        acc[i] = sr * a + acc[i] * inv;
        acc[i + 1] = sg * a + acc[i + 1] * inv;
        acc[i + 2] = sb * a + acc[i + 2] * inv;
        acc[i + 3] = 255 * a + acc[i + 3] * inv;
      }
    }
  }

  // Premultiplied -> straight, so the PNG's colours are the mark's colours
  // wherever it is opaque and a viewer that ignores alpha still sees them.
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const o = i * 4;
    const a = acc[o + 3];
    data[o + 3] = Math.round(a);
    if (a <= 0) continue;
    const s = 255 / a;
    data[o] = Math.min(255, Math.round(acc[o] * s));
    data[o + 1] = Math.min(255, Math.round(acc[o + 1] * s));
    data[o + 2] = Math.min(255, Math.round(acc[o + 2] * s));
  }
  return { width: size, height: size, data };
}

/** The mark at `size`, as PNG bytes. @param {number} size @param {{src?:string, variant?:string}} [opts] */
export function markPng(size, opts = {}) {
  return encodePng(renderMark(size, opts), { filter: 1 });
}

/**
 * Every file this script owns, as `repo-relative path -> bytes`.
 *
 * One function, so `--check` compares exactly what a write would have written
 * and the test can assert the same map against the tree.
 *
 * @param {{src?:string}} [opts]
 * @returns {Map<string, Buffer>}
 */
export function renderAll(opts = {}) {
  const src = opts.src ?? fs.readFileSync(MARK_SVG, 'utf8');
  /** @type {Map<string, Buffer>} */
  const out = new Map();
  /** @type {Map<number, Buffer>} */
  const bySize = new Map();

  for (const size of SIZES) {
    const png = markPng(size, { src });
    bySize.set(size, png);
    out.set(`public/icon-${size}.png`, png);
  }
  // Largest first is what `pngToIco` writes anyway; it sorts.
  out.set(
    'public/favicon.ico',
    pngToIco(ICO_SIZES.map((s) => bySize.get(s) ?? markPng(s, { src }))),
  );
  out.set(
    'vscode/media/icon.png',
    bySize.get(VSCODE_ICON_SIZE) ?? markPng(VSCODE_ICON_SIZE, { src }),
  );
  return out;
}

// ===========================================================================
// The command
// ===========================================================================

/** True when this file was run rather than imported. */
const RUN_DIRECTLY =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (RUN_DIRECTLY) {
  const check = process.argv.includes('--check');
  const rendered = renderAll();
  let failed = false;

  for (const [rel, bytes] of rendered) {
    const file = path.join(ROOT, rel);
    if (check) {
      const existing = fs.existsSync(file) ? fs.readFileSync(file) : Buffer.alloc(0);
      const same = existing.equals(bytes);
      process.stdout.write(`${same ? 'ok  ' : 'DIFF'}  ${rel}\n`);
      if (!same) failed = true;
    } else {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, bytes);
      process.stdout.write(`wrote ${rel} (${bytes.length} bytes)\n`);
    }
  }

  if (failed) {
    process.stdout.write(
      '\nThe committed rasters are not what the SVG renders.\n' +
        'Run `node scripts/brand/render-icons.mjs` and commit the result.\n',
    );
    process.exitCode = 1;
  }
}
