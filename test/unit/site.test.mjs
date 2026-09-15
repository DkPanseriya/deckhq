/**
 * The documentation site, and the promise it has to keep.
 *
 * The product makes no outbound network calls of any kind. Its site is held to
 * the same rule: nothing on a page may be *fetched* from anywhere but the
 * site's own origin — no CDN script, no web font, no analytics beacon, no
 * third-party frame, no tracking pixel. A link a reader chooses to click is a
 * different thing from a request the page makes on their behalf, so links out
 * are allowed and are checked against a small allow-list of this project's own
 * homes instead.
 *
 * Both halves are asserted: the sources under `site/`, and what
 * `site/build.mjs` emits from them, because a build step is exactly where this
 * promise would break without anyone noticing.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, before, after } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const siteDir = path.join(root, 'site');

/** Hosts a reader may be sent to by a link they click. Nothing is fetched from them. */
const LINKABLE = ['github.com', 'www.npmjs.com'];

/**
 * This site's own origin — WP-75.
 *
 * It appears in the sources because the one-line installers are printed on the
 * page as text to copy: `curl -fsSL https://dkpanseriya.github.io/deckhq/
 * install.sh | sh`. A URL a reader copies into their own shell is not a
 * request this page makes, so it is allowed in the source scan and in nothing
 * else: it is deliberately NOT in `LINKABLE`, so an `<a href>` to it would
 * still fail the outbound-link test below, and the fetch test above refuses
 * every absolute URL in a `src` or a `<link href>` whatever the host.
 */
const SELF = 'dkpanseriya.github.io';

/** @param {string} dir @param {string[]} exts */
function walk(dir, exts) {
  /** @type {string[]} */
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) {
      if (name === 'dist' || name === 'node_modules') continue;
      out.push(...walk(full, exts));
    } else if (exts.includes(path.extname(name))) {
      out.push(full);
    }
  }
  return out;
}

let out = '';

before(() => {
  out = fs.mkdtempSync(path.join(os.tmpdir(), 'deckhq-site-'));
  const built = spawnSync(process.execPath, [path.join(siteDir, 'build.mjs'), '--out', out], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(built.status, 0, `site build failed:\n${built.stderr}`);
});

after(() => {
  if (out) fs.rmSync(out, { recursive: true, force: true });
});

test('the site builds every page it navigates to', () => {
  for (const rel of [
    'index.html',
    // WP-94a · the pages that show the product.
    'features.html',
    'look.html',
    'characters.html',
    'studio.html',
    'docs.html',
    'model.html',
    'install.html',
    'hooks-and-privacy.html',
    'adapters.html',
    'faq.html',
    'log/index.html',
    'log/1.html',
    'style.css',
    // WP-82 · the mark, both the SVG the tab strip gets and the dark raster
    // the pages show. `site/favicon.svg` — a crimson square that was nothing
    // the product used — is gone.
    'deckhq-mark.svg',
    'deckhq-mark.png',
  ]) {
    assert.ok(fs.existsSync(path.join(out, rel)), `${rel} was not built`);
  }
});

test('the one-line installers are published, byte for byte, at the URL the pages print', () => {
  // WP-75. The install line on the home page is only true if the file is
  // there, and it is only trustworthy if the bytes are the reviewed ones.
  for (const [name, source] of [
    ['install.ps1', path.join(root, 'scripts', 'install', 'install.ps1')],
    ['install.sh', path.join(root, 'scripts', 'install', 'install.sh')],
  ]) {
    const built = path.join(out, name);
    assert.ok(fs.existsSync(built), `${name} was not published`);
    assert.deepEqual(
      fs.readFileSync(built),
      fs.readFileSync(source),
      `${name} on the site is not the file in the repository`,
    );
  }

  const home = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.match(home, /https:\/\/dkpanseriya\.github\.io\/deckhq\/install\.ps1/);
  assert.match(home, /https:\/\/dkpanseriya\.github\.io\/deckhq\/install\.sh/);
  assert.match(home, /npx deckhq app/);
});

test('every internal link resolves to a file that exists', () => {
  const pages = walk(out, ['.html']);
  assert.ok(pages.length > 100, 'expected the engineering log to be built as pages');
  for (const page of pages) {
    const html = fs.readFileSync(page, 'utf8');
    for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const href = m[1];
      if (/^(https?:|mailto:|#)/.test(href)) continue;
      const target = path.resolve(path.dirname(page), href.split('#')[0]);
      assert.ok(
        fs.existsSync(target),
        `${path.relative(out, page)} points at ${href}, which was not built`,
      );
    }
  }
});

test('SECURITY: no page fetches anything from a third-party host', () => {
  // Every attribute that makes the browser go and get something. `href` is in
  // here for `<link>` only; an `<a href>` is handled by the next test.
  const fetching = /(?:\bsrc|\bsrcset|\bposter|\bdata-src|<link[^>]*\bhref)\s*=\s*"([^"]+)"/gi;
  for (const page of walk(out, ['.html'])) {
    const html = fs.readFileSync(page, 'utf8');
    for (const m of html.matchAll(fetching)) {
      const url = m[1].trim();
      assert.ok(
        !/^(https?:)?\/\//i.test(url),
        `${path.relative(out, page)} fetches ${url} from another origin`,
      );
    }
    assert.ok(!/<script/i.test(html), `${path.relative(out, page)} carries a script`);
    assert.ok(!/<iframe/i.test(html), `${path.relative(out, page)} carries a frame`);
    assert.ok(
      !/\b(fetch\(|XMLHttpRequest|navigator\.sendBeacon|new\s+WebSocket|EventSource)\b/.test(html),
      `${path.relative(out, page)} makes a request of its own`,
    );
  }
});

test('SECURITY: the stylesheet loads no font, image or sheet from anywhere', () => {
  for (const css of [path.join(siteDir, 'style.css'), path.join(out, 'style.css')]) {
    // Comments are stripped first: the file's own header says in words that it
    // has no `@font-face` and no `@import`, and a rule that reads prose would
    // fail on the sentence promising the thing it is checking for.
    const text = fs.readFileSync(css, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/@import/i.test(text), '@import in the stylesheet');
    assert.ok(!/@font-face/i.test(text), '@font-face in the stylesheet');
    for (const m of text.matchAll(/url\(\s*['"]?([^'")]+)/gi)) {
      assert.ok(!/^(https?:)?\/\//i.test(m[1]), `stylesheet fetches ${m[1]}`);
    }
  }
});

test('SECURITY: the sources carry no third-party host either', () => {
  const sources = walk(siteDir, ['.html', '.css', '.svg', '.mjs']);
  const known = new Set(LINKABLE);
  for (const file of sources) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
      const host = m[1].toLowerCase();
      if (host === '127.0.0.1' || host === 'localhost') continue;
      // The one namespace URL the SVG needs; it is never fetched.
      if (host === 'www.w3.org') continue;
      // This site itself, printed as a line to copy. See `SELF`.
      if (host === SELF) continue;
      assert.ok(
        known.has(host),
        `${path.relative(root, file)} names ${host}, which is not one of ${[...known].join(', ')}`,
      );
    }
  }
});

test('SECURITY: an outbound link goes only where a reader is meant to be sent', () => {
  const known = new Set(LINKABLE);
  for (const page of walk(out, ['.html'])) {
    const html = fs.readFileSync(page, 'utf8');
    for (const m of html.matchAll(/<a[^>]*\shref="(https?:\/\/[^"]+)"/gi)) {
      const host = new URL(m[1]).hostname.toLowerCase();
      assert.ok(known.has(host), `${path.relative(out, page)} links out to ${host}`);
    }
  }
});

test('SECURITY: markdown in the log renders as text, never as markup', async () => {
  const { markdown, inline, safeUrl } = await import('../../site/build.mjs');

  const html = markdown('A <script>alert(1)</script> in a paragraph.');
  assert.ok(html.includes('&lt;script&gt;'), 'a script tag survived into the page');
  assert.ok(!html.includes('<script'), 'a script tag survived into the page');

  const fenced = markdown('```\n<img src=x onerror="alert(1)">\n```');
  assert.ok(fenced.startsWith('<pre><code>'), 'a fenced block is not a code block');
  assert.ok(!/<img/i.test(fenced), 'a fenced block created an element');

  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('data:text/html,x'), null);
  assert.equal(safeUrl('//evil.example'), null);
  assert.equal(safeUrl('../index.html'), '../index.html');

  const link = inline('[click](javascript:alert(1))');
  assert.ok(!link.includes('<a '), 'a javascript: URL became a link');

  const img = inline('![x](data:text/html,y)');
  assert.ok(!img.includes('<img'), 'a data: URL became an image');
});

test('the markdown converter handles what the log actually contains', async () => {
  const { markdown } = await import('../../site/build.mjs');

  assert.equal(markdown('# Title'), '<h2>Title</h2>');
  assert.equal(markdown('Just **words** here.'), '<p>Just <strong>words</strong> here.</p>');
  assert.equal(markdown('`code` span'), '<p><code>code</code> span</p>');

  const table = markdown('| a | b |\n|---|---|\n| 1 | `x` |');
  assert.ok(table.includes('<th>a</th>'), 'table header');
  assert.ok(table.includes('<td><code>x</code></td>'), 'table cell with a code span');

  const nested = markdown('- one\n  - two\n- three');
  assert.equal((nested.match(/<ul>/g) ?? []).length, 2, 'a nested list');

  // A code span wrapped back to column 0 inside a list item stays one span.
  const lazy = markdown('- text (`if (x) {\nreturn y }`) more');
  assert.equal((lazy.match(/<code>/g) ?? []).length, 1);

  assert.ok(markdown('> quoted').startsWith('<blockquote>'), 'a block quote');
  assert.equal(markdown('---'), '<hr />');
});

test('the log renders one page per entry, in the order the file has them', async () => {
  const { splitEntries } = await import('../../site/build.mjs');
  const source = fs.readFileSync(path.join(root, 'docs', 'DEVIATIONS.md'), 'utf8');
  const { entries } = splitEntries(source);

  assert.ok(entries.length > 100, 'expected the whole log');
  for (const [i] of entries.entries()) {
    assert.ok(fs.existsSync(path.join(out, 'log', `${i + 1}.html`)), `log entry ${i + 1}`);
  }

  const index = fs.readFileSync(path.join(out, 'log', 'index.html'), 'utf8');
  assert.ok(index.includes(`${entries.length} entries`), 'the index counts the entries it lists');

  // Entry numbers repeat in the source (two 48s, two 49s), which is why the
  // file name is the position rather than the number. If that ever stops being
  // true the log can move to numbered URLs; until then this is the reason.
  const numbers = entries.map((e) => e.number).filter(Boolean);
  assert.ok(numbers.length > 0);

  const first = fs.readFileSync(path.join(out, 'log', '1.html'), 'utf8');
  assert.ok(first.includes('<p class="log-number">'), 'an entry shows the number it carries');
});

test('the site says nothing the product refuses to say', () => {
  // docs/plan/08-PLAN-V2-100X.md §4.2: never "cannot see", never "invisible",
  // never "hidden" about another tool. The honesty tests enforce this inside
  // the product; this is the same rule for the copy around it.
  const banned = [/cannot see/i, /can'?t see/i, /\binvisible\b/i, /\bhides? (them|these|those)\b/i];
  for (const page of walk(out, ['.html'])) {
    if (path.basename(path.dirname(page)) === 'log') continue; // the log is a record, not copy
    const html = fs.readFileSync(page, 'utf8');
    for (const pattern of banned) {
      assert.ok(!pattern.test(html), `${path.relative(out, page)} matches ${pattern}`);
    }
  }
});

test('the build copies every image its pages reference', () => {
  for (const page of walk(out, ['.html'])) {
    const html = fs.readFileSync(page, 'utf8');
    for (const m of html.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)) {
      const target = path.resolve(path.dirname(page), m[1]);
      assert.ok(fs.existsSync(target), `${path.relative(out, page)} shows a missing ${m[1]}`);
    }
  }
});

/* ------------------------------------------------------------------ WP-94a */

test('every page carries exactly one h1', () => {
  for (const page of walk(out, ['.html'])) {
    const html = fs.readFileSync(page, 'utf8');
    const count = (html.match(/<h1[\s>]/g) ?? []).length;
    assert.equal(count, 1, `${path.relative(out, page)} has ${count} h1 elements`);
  }
});

test('every image carries alt text, and every photograph carries words', () => {
  for (const page of walk(out, ['.html'])) {
    const html = fs.readFileSync(page, 'utf8');
    for (const m of html.matchAll(/<img\b[^>]*>/g)) {
      const tag = m[0];
      const alt = tag.match(/\salt="([^"]*)"/);
      assert.ok(alt, `${path.relative(out, page)} has an image with no alt attribute: ${tag}`);
      // `alt=""` is correct for the mark beside the wordmark — it is decoration
      // beside text that already says DeckHQ — and wrong for anything under
      // `media/`, which is the only thing on these pages carrying information a
      // sighted reader gets and a screen reader would not.
      const src = (tag.match(/\ssrc="([^"]+)"/) ?? ['', ''])[1];
      if (/(^|\/)media\//.test(src)) {
        assert.ok(
          alt[1].trim().length > 20,
          `${path.relative(out, page)} shows ${src} with no useful alt text`,
        );
      }
    }
  }
});

test('the only hosts anywhere on the site are GitHub, npm and this site', () => {
  // A stricter restatement of the two SECURITY tests above, over every absolute
  // URL in the written pages whatever attribute or text it sits in: the Pages
  // origin (printed as a line to copy), and the two places a reader is sent.
  //
  // The engineering log is a record rather than copy, and it quotes hosts —
  // `http://127x0x0x1`, the hostname §115's glob test pins — that are the
  // subject of an entry rather than a link. Its links and its fetches are
  // covered by the two SECURITY tests above, which do read it.
  const allowed = new Set([...LINKABLE, SELF]);
  for (const page of walk(out, ['.html'])) {
    if (path.basename(path.dirname(page)) === 'log') continue;
    const html = fs.readFileSync(page, 'utf8');
    for (const m of html.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
      const host = m[1].toLowerCase();
      if (host === '127.0.0.1' || host === 'localhost' || host === 'www.w3.org') continue;
      assert.ok(allowed.has(host), `${path.relative(out, page)} names ${host}`);
    }
  }
});

test('HONESTY: a mockup is never shown as a screenshot', async () => {
  // WP-94a, and `docs/ADAPTERS.md` §6 applied to pictures. Every image the site
  // copies has a class in `docs/MEDIA.md`: a capture is DeckHQ photographed, a
  // golden is a real render of a fixture, an illustration is a drawing of a
  // specification that no build has produced. The last one has to say so.
  const { imageClass, assertMediaIsLabelled, IMAGES, ILLUSTRATION_DIRS, ILLUSTRATION_LABEL } =
    await import('../../site/build.mjs');

  // Every illustration source really is under one of the mockup directories,
  // and every image under one of them really is declared an illustration.
  for (const image of IMAGES) {
    const dir = image.from.startsWith('docs/media/') ? image.from.split('/')[2] : null;
    const isMockupDir = dir !== null && ILLUSTRATION_DIRS.includes(dir);
    assert.equal(
      image.class === 'illustration',
      isMockupDir,
      `${image.from} is declared ${image.class}`,
    );
    assert.equal(imageClass(image.to), image.class, `${image.to} resolves to the wrong class`);
  }

  // Every illustration on a built page sits in a figure whose caption says so.
  const illustrations = IMAGES.filter((i) => i.class === 'illustration').map((i) => i.to);
  let shown = 0;
  for (const page of walk(out, ['.html'])) {
    const html = fs.readFileSync(page, 'utf8');
    for (const figure of html.matchAll(/<figure[\s>][\s\S]*?<\/figure>/g)) {
      const caption = (figure[0].match(/<figcaption[\s>]([\s\S]*?)<\/figcaption>/) ?? ['', ''])[1];
      for (const img of figure[0].matchAll(/<img[^>]*\ssrc="([^"]+)"/g)) {
        const rel = img[1].replace(/^(?:\.\.\/)*media\//, '');
        if (!illustrations.includes(rel)) continue;
        shown++;
        assert.ok(
          caption.toLowerCase().includes(ILLUSTRATION_LABEL),
          `${path.relative(out, page)} shows the mockup ${rel} without "${ILLUSTRATION_LABEL}"`,
        );
      }
    }
  }
  assert.ok(shown >= 8, `expected the mockups to be published; found ${shown}`);

  // And the gate refuses a page that forgets. Without this the test above
  // passes on a site that happens to be correct and a gate that does nothing.
  const bad = `<figure><img src="media/${illustrations[0]}" alt="x" /><figcaption>The floor.</figcaption></figure>`;
  assert.throws(() => assertMediaIsLabelled('bad.html', bad), /mockup/);
  const loose = `<img src="media/${illustrations[0]}" alt="x" />`;
  assert.throws(() => assertMediaIsLabelled('loose.html', loose), /outside a figure/);
  const unknown = '<img src="media/not-in-the-registry.png" alt="x" />';
  assert.throws(() => assertMediaIsLabelled('unknown.html', unknown), /not in the media registry/);

  // A labelled one is fine.
  const good = `<figure><img src="media/${illustrations[0]}" alt="x" /><figcaption>A drawing. <span class="tag tag--illustration">Design illustration</span></figcaption></figure>`;
  assert.doesNotThrow(() => assertMediaIsLabelled('good.html', good));
});

test('no image the site serves is wider than the capture stage', async () => {
  const { MAX_IMAGE_WIDTH } = await import('../../site/build.mjs');
  const { decodePng } = await import('../../scripts/lib/png.mjs');
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let checked = 0;
  for (const image of walk(path.join(out, 'media'), ['.png'])) {
    const bytes = fs.readFileSync(image);
    if (!bytes.subarray(0, 8).equals(signature)) continue;
    let width;
    try {
      width = decodePng(bytes).width;
    } catch {
      continue; // a shape this decoder does not read is copied whole on purpose
    }
    checked++;
    assert.ok(
      width <= MAX_IMAGE_WIDTH,
      `media/${path.relative(path.join(out, 'media'), image)} is ${width} px wide`,
    );
  }
  assert.ok(checked > 10, 'expected the site to carry images');
});

test('the deployment workflow builds the site it deploys', () => {
  const yml = fs.readFileSync(path.join(root, '.github', 'workflows', 'pages.yml'), 'utf8');
  assert.match(yml, /node site\/build\.mjs/, 'the workflow runs the build');
  assert.match(yml, /path:\s*site\/dist/, 'the workflow uploads what the build wrote');
  assert.match(yml, /branches:\s*\[main\]/, 'the workflow deploys from main');
});
