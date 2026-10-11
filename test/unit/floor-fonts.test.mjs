/**
 * THE TYPEFACE THE PRODUCT SHIPS (`public/fonts/`): the files are the ones the
 * provenance table says they are, they are served from the product's own
 * origin and from nowhere else, and the page, the stylesheet and the floor's
 * font table name the same three families.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUNDLED_FONT_PROBES,
  FONT_FAMILIES,
  loadBundledFonts,
} from '../../public/render/floor-type.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FONTS = path.join(REPO, 'public/fonts');
const read = (/** @type {string} */ file) => fs.readFileSync(path.join(REPO, file), 'utf8');
/** A stylesheet without its comments. */
const css = () => read('public/style.css').replace(/\/\*[\s\S]*?\*\//g, '');

/** The provenance table's rows: file, source, bytes, hash. */
function provenance() {
  // The table is padded into columns by the formatter: any space after a name.
  const rows = read('public/fonts/PROVENANCE.md').matchAll(/^\| `([^`]+)`\s*\|(.*)\|$/gm);
  return [...rows].map((m) => {
    const cells = m[2].split('|').map((c) => c.trim());
    return {
      file: m[1],
      source: cells[2],
      bytes: Number(cells[3]),
      sha256: cells[4].replace(/`/g, ''),
    };
  });
}

/** Every `@font-face` block of the stylesheet, as its declarations. */
function faces() {
  return [...css().matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => {
    /** @type {Record<string, string>} */
    const out = {};
    for (const line of m[1].split(';')) {
      const at = line.indexOf(':');
      if (at > 0) out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    }
    return out;
  });
}

test('INVARIANT: every file in public/fonts is the one its provenance row names, byte for byte', () => {
  const rows = provenance();
  const onDisk = fs
    .readdirSync(FONTS)
    .filter((f) => f !== 'PROVENANCE.md')
    .sort();
  assert.deepEqual(
    rows.map((r) => r.file).sort(),
    onDisk,
    'a file with no row, or a row with none',
  );
  for (const row of rows) {
    const bytes = fs.readFileSync(path.join(FONTS, row.file));
    assert.equal(bytes.length, row.bytes, `${row.file} is not the size its row says`);
    assert.equal(
      crypto.createHash('sha256').update(bytes).digest('hex'),
      row.sha256,
      `${row.file} is not the file its row names`,
    );
    // Each came from its maker's own repository, at a release tag.
    assert.match(
      row.source,
      /^https:\/\/github\.com\/(rsms\/inter|JetBrains\/JetBrainsMono)\/raw\/v[\d.]+\//,
      `${row.file} has no source at a release tag`,
    );
  }
  // Fonts and their licences, and nothing that could run.
  for (const file of onDisk)
    assert.match(file, /\.(woff2|txt)$/, `${file} is not a font or a licence`);
  for (const file of onDisk.filter((f) => f.endsWith('.woff2'))) {
    const head = fs.readFileSync(path.join(FONTS, file)).subarray(0, 4).toString('latin1');
    assert.equal(head, 'wOF2', `${file} is not a WOFF2 file`);
  }
});

test('each typeface travels with its licence, and the licence is the Open Font License', () => {
  for (const file of ['OFL-Inter.txt', 'OFL-JetBrainsMono.txt']) {
    const text = fs.readFileSync(path.join(FONTS, file), 'utf8');
    assert.match(text, /SIL Open Font License, Version 1\.1/, file);
    assert.match(text, /^Copyright/m, `${file} names no copyright holder`);
  }
});

test('INVARIANT: a font is fetched from this origin and from nowhere else', () => {
  const sheet = css();
  const urls = [...sheet.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((m) => m[1]);
  const fontUrls = urls.filter((u) => /\.woff2?(\?|#|$)/.test(u));
  assert.ok(fontUrls.length >= 3);
  for (const u of fontUrls) {
    assert.match(u, /^\.\/fonts\/[A-Za-z0-9-]+\.woff2$/, `${u} is not a file of this folder`);
    assert.ok(fs.existsSync(path.join(REPO, 'public', u)), `${u} is not shipped`);
  }
  // No stylesheet import, no font service, and no absolute address at all.
  for (const file of ['public/style.css', 'public/index.html']) {
    const text = read(file);
    assert.doesNotMatch(text, /fonts\.(googleapis|gstatic)|use\.typekit|rsms\.me\/inter/, file);
    assert.doesNotMatch(text.replace(/<!--[\s\S]*?-->/g, ''), /@import\b/, file);
  }
  // Every shipped font file is declared, so none is dead weight in the package.
  const declared = new Set(fontUrls.map((u) => path.basename(u)));
  for (const file of fs.readdirSync(FONTS).filter((f) => f.endsWith('.woff2'))) {
    assert.ok(declared.has(file), `${file} is shipped and never declared`);
  }
});

test('the stylesheet declares the three families the floor asks for, by role', () => {
  const all = faces();
  const families = [...new Set(all.map((f) => f['font-family']))];
  assert.deepEqual(families, ["'DeckHQ Sans'", "'DeckHQ Numeric'", "'DeckHQ Mono'"]);
  for (const face of all) {
    assert.equal(face['font-display'], 'swap', `${face['font-family']} blocks text while it loads`);
    assert.match(face.src, /format\('woff2'\)/);
  }
  // THE NUMERIC FAMILY IS THE SANS WITH TABULAR FIGURES: the same file, and the
  // feature switched on in the face itself — the one place a canvas, which
  // cannot ask for a font feature, can be given figures that line up.
  const sans = all.find((f) => f['font-family'] === "'DeckHQ Sans'");
  const numeric = all.find((f) => f['font-family'] === "'DeckHQ Numeric'");
  assert.equal(numeric?.src, sans?.src);
  assert.match(String(numeric?.['font-feature-settings']), /'tnum'/);
  assert.equal(sans?.['font-feature-settings'], undefined);
  // The floor's table and the chrome's variables lead with the same names.
  const f = FONT_FAMILIES.deckhq;
  assert.match(f.sans, /^'DeckHQ Sans', /);
  assert.match(f.numeric, /^'DeckHQ Numeric', /);
  assert.match(f.mono, /^'DeckHQ Mono', /);
  const sheet = css();
  const variable = (/** @type {string} */ name) =>
    String(new RegExp(`:root \\{[\\s\\S]*?--${name}:\\s*([^;]+);`).exec(sheet)?.[1]).replace(
      /\s+/g,
      ' ',
    );
  assert.equal(variable('font-sans'), f.sans);
  assert.equal(variable('font-num'), f.numeric);
  assert.equal(variable('font-mono'), f.mono);
});

test('a look set in `system` puts the chrome in the machine’s own faces too', () => {
  const block = /:root\[data-font='system'\]\s*\{([^}]*)\}/.exec(css());
  assert.ok(block, 'no rule for a look whose font is system');
  const value = (/** @type {string} */ name) =>
    String(new RegExp(`--${name}:\\s*([^;]+);`).exec(block[1])?.[1]).replace(/\s+/g, ' ');
  assert.equal(value('font-sans'), FONT_FAMILIES.system.sans);
  assert.equal(value('font-num'), FONT_FAMILIES.system.numeric);
  assert.equal(value('font-mono'), FONT_FAMILIES.system.mono);
  assert.doesNotMatch(block[1], /DeckHQ/);
});

test('the page asks for the typeface before the floor is drawn, and survives not getting it', async () => {
  // The sans is preloaded with the page: it is the file every name is set in.
  const link = /<link\b[^>]*rel="preload"[^>]*>/.exec(read('public/index.html'))?.[0] || '';
  assert.match(link, /href="\.\/fonts\/InterVariable\.woff2"/);
  assert.match(link, /as="font"/);
  assert.match(link, /crossorigin/, 'a font preload without crossorigin is fetched twice');
  // …and the floor's boot asks for one probe per file.
  assert.equal(BUNDLED_FONT_PROBES.length, 4);
  /** @type {string[]} */
  const asked = [];
  await loadBundledFonts({
    fonts: {
      load: (/** @type {string} */ probe) => {
        asked.push(probe);
        return probe.includes('Mono') ? Promise.reject(new Error('no file')) : Promise.resolve([]);
      },
    },
  });
  assert.deepEqual(asked, [...BUNDLED_FONT_PROBES], 'a refused file stopped the others');
  // No document, or one that cannot load fonts: nothing to do, and no throw.
  await loadBundledFonts(undefined);
  await loadBundledFonts({});
  assert.match(read('public/app-floor.js'), /loadBundledFonts\(document\)/);
});

test('the daemon serves a font as a font, and its policy lets the page load one from itself only', () => {
  const server = read('src/http/server.mjs');
  assert.match(server, /'\.woff2': 'font\/woff2'/);
  assert.match(server, /font-src 'self'/);
});
