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

/** The stylesheet's two source files; `site/build.mjs` serves them as one. */
const STYLE_SOURCES = ['style.css', 'components.css'];

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
    // The pages that show the product. Characters and Studio were pages of
    // their own until 1.7.0; both are sections of Features now, where the six
    // states and the board sit beside the things they belong to.
    'features.html',
    'look.html',
    'install.html',
    'privacy.html',
    'faq.html',
    'changelog.html',
    // What GitHub Pages serves for an address that is not there.
    '404.html',
    'style.css',
    // The one script. Everything it does, the page does without it;
    // `site/site.js`'s header says which four things they are. The second
    // script, which stored a colour scheme, went with the light scheme.
    'site.js',
    'sitemap.txt',
    'robots.txt',
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
  assert.equal(pages.length, 8, 'the site is eight pages');
  for (const page of pages) {
    const html = fs.readFileSync(page, 'utf8');
    const where = path.relative(out, page);
    // The one absolute path on the site is the 404 page's `<base>`: GitHub
    // Pages serves that file for a missing address at any depth, so its links
    // have to resolve from the site's own root. It is checked on its own, and
    // no other page may carry one.
    const base = html.match(/<base href="([^"]+)" \/>/);
    assert.equal(base ? base[1] : null, where === '404.html' ? '/deckhq/' : null, `${where}: base`);
    const links = html.replace(/<base [^>]*>/, '');
    for (const m of links.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const href = m[1];
      if (/^(https?:|mailto:|#)/.test(href)) continue;
      const target = path.resolve(path.dirname(page), href.split('#')[0]);
      assert.ok(fs.existsSync(target), `${where} points at ${href}, which was not built`);
    }
    // A `srcset` names files too, and a dense screen fetches the second one.
    for (const m of links.matchAll(/\ssrcset="([^"]+)"/g)) {
      for (const candidate of m[1].split(',')) {
        const file = candidate.trim().split(/\s+/)[0];
        assert.ok(
          fs.existsSync(path.resolve(path.dirname(page), file)),
          `${where} offers ${file} in a srcset, which was not built`,
        );
      }
    }
    // And an anchor inside the site lands on something.
    for (const m of links.matchAll(/href="([\w-]+\.html)#([\w-]+)"/g)) {
      const target = fs.readFileSync(path.join(out, m[1]), 'utf8');
      assert.ok(
        target.includes(`id="${m[2]}"`),
        `${where} links ${m[1]}#${m[2]}, which is not there`,
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
    // WP-94c · a page may carry a script, and only of one shape: a `src` to a
    // file on this origin. An INLINE script is still refused, because an
    // inline script is the one that never has to be reviewed as a file, and
    // the `src` case is already covered by the loop above, which refuses every
    // absolute URL whatever the host.
    for (const tag of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      assert.match(
        tag[1],
        /\ssrc="[^"]+"/,
        `${path.relative(out, page)} carries a script with no src`,
      );
      assert.equal(tag[2].trim(), '', `${path.relative(out, page)} carries an inline script`);
    }
    assert.ok(!/<iframe/i.test(html), `${path.relative(out, page)} carries a frame`);
    assert.ok(
      !/\b(fetch\(|XMLHttpRequest|navigator\.sendBeacon|new\s+WebSocket|EventSource)\b/.test(html),
      `${path.relative(out, page)} makes a request of its own`,
    );
  }
});

test('SECURITY: the script fetches nothing and stores nothing', () => {
  // The same promise, applied to the only JavaScript on this site; if it ever
  // reached the network, the sentence in every page footer would be false. It
  // used to be allowed one stored key, for the colour scheme. There is one
  // scheme now, so it is allowed none.
  assert.ok(!fs.existsSync(path.join(siteDir, 'theme.js')), 'the scheme script is back');
  assert.deepEqual(
    walk(out, ['.js']).map((f) => path.relative(out, f)),
    ['site.js'],
    'the site serves a script other than site.js',
  );
  for (const name of ['site.js']) {
    for (const file of [path.join(siteDir, name), path.join(out, name)]) {
      const text = fs.readFileSync(file, 'utf8');
      assert.ok(
        !/\b(fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts)\b/.test(
          text,
        ),
        `${name} makes a request`,
      );
      assert.ok(!/https?:\/\//.test(text), `${name} names an absolute URL`);
      assert.ok(
        !/\b(localStorage|sessionStorage|indexedDB|document\.cookie)\b/.test(text),
        `${name} stores something in the browser`,
      );
    }
    assert.deepEqual(
      fs.readFileSync(path.join(siteDir, name)),
      fs.readFileSync(path.join(out, name)),
      `${name} on the site is not the file in the repository`,
    );
  }
});

test('SECURITY: the stylesheet loads no font, image or sheet from anywhere', () => {
  for (const css of [
    ...STYLE_SOURCES.map((name) => path.join(siteDir, name)),
    path.join(out, 'style.css'),
  ]) {
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

/* ------------------------------------------------------------------ WP-95a */

test('BLUEPRINT: no page names an internal document, a package or a section', async () => {
  // The owner: *"The website is purely public marketing and PR. Do not put
  // requirements and architecture docs there."* and *"Although it is public on
  // GitHub, I would not give the blueprint so anybody can build it."*
  //
  // So the site is held to a pattern list rather than to a reviewer's memory.
  // It runs over everything the reader receives — links, prose, alt text,
  // captions, class names and HTML comments — on every built page.
  const { INTERNAL, assertNothingInternal } = await import('../../site/build.mjs');

  // The pages, and the stylesheet and scripts served beside them: a reader can
  // open `style.css` at its own URL, so a package id in a comment there is as
  // public as one in a paragraph.
  //
  // `install.ps1`, `install.sh` and `deckhq-mark.svg` are published from
  // `scripts/` and `public/` and each still carries one, which WP-95b takes
  // with the rest of them.
  const files = walk(out, ['.html', '.css', '.js']);
  assert.ok(files.length > 0, 'nothing was built');
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const pattern of INTERNAL) {
      const hit = pattern.exec(text);
      assert.equal(
        hit,
        null,
        `${path.relative(out, file)} names ${hit && hit[0]}, which belongs to the blueprint`,
      );
    }
  }

  // And the gate refuses one, so this test is not passing on a site that
  // happens to be clean and a build step that checks nothing.
  for (const bad of [
    '<a href="docs/plan/08-PLAN-V2-100X.md">the plan</a>',
    '<p>See docs/DEVIATIONS.md.</p>',
    '<p>00-REQUIREMENTS has the row.</p>',
    '<p>02-ARCHITECTURE, the process model.</p>',
    '<p>The ARCHITECTURE-AUDIT found three.</p>',
    '<p>STUDIO-DESIGN is the full version.</p>',
    '<p>RELAY-DESIGN is the one after.</p>',
    '<p>WP-88 is designed to add it.</p>',
    '<p>§178 measured it.</p>',
  ]) {
    assert.throws(() => assertNothingInternal('bad.html', bad), /blueprint/, bad);
  }
  assert.doesNotThrow(() => assertNothingInternal('good.html', '<p>Six presets, and a rug.</p>'));
});

test('the changelog publishes the highlights and nothing under them', async () => {
  const { releaseHighlights } = await import('../../site/build.mjs');
  const releases = releaseHighlights(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'));

  assert.ok(releases.length >= 2, 'expected the released versions to carry highlights');
  for (const release of releases) {
    assert.match(release.version, /^\d+\.\d+\.\d+$/);
    assert.ok(release.highlights.length > 80, `${release.version} has almost no highlights`);
    assert.ok(!/^\s*[-*+]\s/m.test(release.highlights), `${release.version} published a bullet`);
  }

  // The newest release is on the page, the bullet dump under it is not, and the
  // full file is one link away.
  const html = fs.readFileSync(path.join(out, 'changelog.html'), 'utf8');
  const main = html.slice(html.indexOf('<main id="main">'), html.indexOf('</main>'));
  assert.ok(main.includes(releases[0].version), 'the newest release is not on the page');
  assert.ok(!/<[uo]l>/.test(main), 'the changelog page carries a bullet list');
  assert.match(html, /blob\/main\/CHANGELOG\.md/, 'the page does not link the full changelog');

  // An unreleased section carries no version, so it is never published early.
  assert.ok(!releases.some((r) => r.version.toLowerCase().includes('unreleased')));
});

test('SECURITY: markdown renders as text, never as markup', async () => {
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

test('the markdown converter handles what a release note contains', async () => {
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

test('the site publishes no page the blueprint used to put here', () => {
  // WP-95a. The five that went, by the URL they had: a stranger who followed
  // an old link gets a 404 from GitHub Pages rather than the document.
  for (const gone of [
    'docs.html',
    'model.html',
    'adapters.html',
    'hooks-and-privacy.html',
    'log/index.html',
    'log/1.html',
    // 1.7.0 · merged into Features, and the scheme script that went with the
    // light scheme.
    'characters.html',
    'studio.html',
    'theme.js',
  ]) {
    assert.ok(!fs.existsSync(path.join(out, gone)), `${gone} is still published`);
  }
});

test('the site says nothing the product refuses to say', () => {
  // docs/plan/08-PLAN-V2-100X.md §4.2: never "cannot see", never "invisible",
  // never "hidden" about another tool. The honesty tests enforce this inside
  // the product; this is the same rule for the copy around it.
  const banned = [/cannot see/i, /can'?t see/i, /\binvisible\b/i, /\bhides? (them|these|those)\b/i];
  for (const page of walk(out, ['.html'])) {
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
  // URL on every page whatever attribute or text it sits in: the Pages origin
  // (printed as a line to copy), and the two places a reader is sent.
  const allowed = new Set([...LINKABLE, SELF]);
  for (const page of walk(out, ['.html'])) {
    const html = fs.readFileSync(page, 'utf8');
    for (const m of html.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
      const host = m[1].toLowerCase();
      if (host === '127.0.0.1' || host === 'localhost' || host === 'www.w3.org') continue;
      assert.ok(allowed.has(host), `${path.relative(out, page)} names ${host}`);
    }
  }
});

test('HONESTY: every picture is a declared capture, and the unreleased say so', async () => {
  // Every picture the site serves is the running product, photographed against
  // a fixture floor by `scripts/site-assets.mjs` from `site/assets.json`. So a
  // file in the built site's `media/` has to be one that manifest declares.
  // Two kinds are let in by name and nothing else is: the composed card a link
  // unfurls into, and pictures of something not released, which must sit in a
  // figure whose caption carries the "Coming" tag.
  const { declaredMedia, assertComingIsLabelled, COMING, PREVIEW, MEDIA_DIR } =
    await import('../../site/build.mjs');
  const { COMPOSED } = await import('../../site/media.mjs');
  const declared = declaredMedia();
  const served = walk(path.join(out, 'media'), ['.png', '.gif']).map((f) => path.basename(f));
  assert.ok(served.length > 30, `expected the site to carry pictures; found ${served.length}`);
  for (const file of served) {
    assert.ok(
      declared.has(file) || COMING.includes(file) || COMPOSED.includes(file),
      `media/${file} is served and is not declared in site/assets.json`,
    );
    assert.deepEqual(
      fs.readFileSync(path.join(out, 'media', file)),
      fs.readFileSync(path.join(MEDIA_DIR, file)),
      `media/${file} is not the capture in the repository`,
    );
  }
  assert.deepEqual(COMPOSED, [PREVIEW], 'a second composed picture is published');

  // No capture was taken on a real floor: the manifest names fixture
  // populations only, and every one of them exists.
  // (Read as text: importing the fixtures module would parse this process's
  // own arguments as a demo's.)
  const fixtures = fs.readFileSync(path.join(root, 'scripts', 'demo-populations.mjs'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(siteDir, 'assets.json'), 'utf8'));
  for (const asset of manifest.assets) {
    assert.match(
      fixtures,
      new RegExp(`^  '?${asset.population}'?: `, 'm'),
      `${asset.name} names no fixture: ${asset.population}`,
    );
  }

  // The unreleased are only on the home page, in one band, and each is tagged.
  for (const page of walk(out, ['.html'])) {
    const html = fs.readFileSync(page, 'utf8');
    const where = path.relative(out, page);
    const shown = COMING.filter((file) => html.includes(`media/${file}`));
    if (where !== 'index.html') {
      assert.deepEqual(shown, [], `${where} shows something unreleased`);
      assert.ok(!/tag--coming/.test(html), `${where} carries a "Coming" tag`);
      // The changelog is the release notes' own words and is not held to this.
      if (where !== 'changelog.html') assert.ok(!/\b3D\b/.test(html), `${where} talks about 3D`);
      continue;
    }
    if (shown.length === 0) continue;
    assert.doesNotThrow(() => assertComingIsLabelled(where, html));
    for (const figure of html.matchAll(/<figure[\s>][\s\S]*?<\/figure>/g)) {
      if (!COMING.some((file) => figure[0].includes(`media/${file}`))) continue;
      assert.match(figure[0], /<span class="tag tag--coming">Coming<\/span>/);
    }
    // What is never said beside it: a date, a price, a tier, or a first.
    const band = html.slice(html.indexOf('The same office, stood up.'));
    const words = band.slice(0, band.indexOf('</section>')).replace(/<[^>]*>/g, ' ');
    for (const never of [
      /\bPro\b/,
      /\bfirst\b/i,
      /\bonly\b/i,
      /\bsoon\b/i,
      /\b20\d\d\b/,
      /[$€£]/,
    ]) {
      assert.ok(!never.test(words), `the Coming band says ${never}`);
    }
  }

  // The gate refuses a loose one, so this is not passing on a clean site and a
  // build step that checks nothing.
  const loose = `<img src="media/${COMING[0]}" alt="x" />`;
  assert.throws(() => assertComingIsLabelled('bad.html', loose), /without a "Coming" tag/);
  const tagged = `<figure>${loose}<figcaption><span class="tag tag--coming">Coming</span></figcaption></figure>`;
  assert.doesNotThrow(() => assertComingIsLabelled('good.html', tagged));
});

test('a band whose picture is absent is left out of the build', async () => {
  const { resolveOptional } = await import('../../site/build.mjs');
  const page = 'a\n<!-- if media/not-captured.png -->\n<p>gone</p>\n<!-- endif -->\nb\n';
  assert.equal(resolveOptional(page), 'a\nb\n');
  const kept = 'a\n<!-- if media/hero.png -->\n<p>kept</p>\n<!-- endif -->\nb\n';
  assert.equal(resolveOptional(kept), 'a\n<p>kept</p>\nb\n');
});

test('no picture the site serves is wider than the hero at twice its size', async () => {
  // 2400 px: the widest column on the site is 1200 CSS pixels, doubled for a
  // dense screen, and never more. The size is read from the file's own header.
  const { imageSize } = await import('../../site/build.mjs');
  let checked = 0;
  for (const image of walk(path.join(out, 'media'), ['.png', '.gif'])) {
    const size = imageSize(image);
    const where = `media/${path.basename(image)}`;
    assert.ok(size, `${where} is not a picture this build can measure`);
    checked++;
    assert.ok(size.width <= 2400, `${where} is ${size.width} px wide`);
    // A plain file beside a dense one is exactly half of it.
    if (image.endsWith('@2x.png')) {
      const plain = imageSize(image.replace('@2x.png', '.png'));
      assert.ok(plain, `${where} has no plain file beside it`);
      assert.equal(plain.width * 2, size.width, `${where} is not twice its plain file`);
    }
  }
  assert.ok(checked > 30, 'expected the site to carry pictures');
});

/* ------------------------------------------------------------------ WP-94b */

/**
 * The visible words of one page: markup gone, and code gone with it.
 *
 * `<code>` and `<pre>` are stripped before the scan because they are not
 * prose — a TypeScript interface on the Adapters page contains the word
 * "option", and a shell line contains almost anything. The rules below are
 * about what the site SAYS.
 *
 * @param {string} html a hand-written page body
 */
function prose(html) {
  return html
    .replace(/<pre[\s\S]*?<\/pre>/g, ' ')
    .replace(/<code[\s\S]*?<\/code>/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#8212;/g, '—')
    .replace(/&#8217;/g, '’')
    .replace(/\s+/g, ' ');
}

/**
 * COPY: the phrases this site does not use — WP-94b.
 *
 * The owner's review of 26 September asked for the defensive writing and the
 * AI slop to go. Both are recognisable, so they are a list rather than a
 * judgement: the negation-then-assertion move, the puffery vocabulary, the
 * reflexive hedge, and the words that describe how something was designed
 * rather than what it does.
 */
const FORBIDDEN = [
  [/not (just|only|merely|simply|solely) [^.;]{2,80}(but|it’s)/i, 'the "not X but Y" move'],
  [/isn’?t (just|only|merely|simply|about)/i, 'the "not X but Y" move'],
  [/not only [^.;]{2,80}but/i, 'the "not X but Y" move'],
  [/less about [^.;]{2,60}(than|and more about)/i, 'the "not X but Y" move'],
  [/more than (just|a mere|simply)/i, 'the "not X but Y" move'],
  [/\bdesigned to\b/i, 'puffery: say what it does'],
  [/\bseamless(ly)?\b|\brobust\b|\bpowerful\b|\bholistic\b|\bsynergy\b/i, 'puffery'],
  [/\bleverage(s|d)?\b|\bmeticulous|\bintricate\b|\bboasts\b|\bempower/i, 'puffery'],
  [/game.?chang|cutting.?edge|\bdelve|\btapestry\b|\btestament\b/i, 'puffery'],
  [/\bshowcas(e|es|ing)\b|\bunlock(s|ing)? (the|your)\b|\bharness(es|ing)? the\b/i, 'puffery'],
  [/ever.?(evolving|changing)|fast.?paced|in today’?s\b|when it comes to/i, 'puffery'],
  [/it’?s (worth|important) (to note|noting|to remember)/i, 'a hedge: say it'],
  [/(that|it) (being )?said,|while (it’?s|this is) (true|important)/i, 'a hedge'],
  [/\barguably\b|in many ways|to some (extent|degree)|on the other hand/i, 'a hedge'],
  [/at its core|in essence|essentially,|ultimately,|in conclusion|in summary/i, 'a hedge'],
  [/\boverall,|in the end,|needless to say|as (we|you) (can see|know)/i, 'a hedge'],
  [/let’?s (dive|unpack|explore|take a (look|closer look))/i, 'a hedge'],
  [/\bcandidates?\b|\bchosen\b|\branking\b|\branked\b/i, 'the design journey'],
  [/before.and.after|before\/after|direction [ABCD]\b|material board/i, 'the design journey'],
  [/\boptions?\b(?! for)/i, 'the design journey: show what there is'],
];

test('COPY: the site says nothing in the shape of AI slop', () => {
  for (const name of fs.readdirSync(path.join(siteDir, 'pages'))) {
    const text = prose(fs.readFileSync(path.join(siteDir, 'pages', name), 'utf8'));
    for (const [pattern, why] of FORBIDDEN) {
      const hit = pattern.exec(text);
      assert.equal(
        hit,
        null,
        `${name} uses ${why}: "${hit && text.slice(Math.max(0, hit.index - 30), hit.index + hit[0].length + 30).trim()}"`,
      );
    }
  }
});

test('COPY: an em dash is a punctuation mark, not a rhythm', () => {
  // One per 150 words. The site is allowed the mark — the log entries it
  // renders are full of them — and is not allowed to reach for it as a
  // cadence. Over the budget, a page is being written rather than said.
  for (const name of fs.readdirSync(path.join(siteDir, 'pages'))) {
    const text = prose(fs.readFileSync(path.join(siteDir, 'pages', name), 'utf8'));
    const words = text.split(/\s+/).filter(Boolean).length;
    const dashes = (text.match(/—/g) ?? []).length;
    const budget = Math.max(1, Math.round(words / 150));
    assert.ok(
      dashes <= budget,
      `${name} has ${dashes} em dashes in ${words} words; the budget is ${budget}`,
    );
  }
});

test('COPY: a picture that is not built says so where it is shown', () => {
  // WP-94b. An illustration is published only for something that is coming,
  // and the reader who skims the pictures and reads none of the words has to
  // be able to tell. So the "Coming" tag sits in the caption, beside the
  // "Design illustration" label, on every one of them.
  for (const name of fs.readdirSync(path.join(siteDir, 'pages'))) {
    const html = fs.readFileSync(path.join(siteDir, 'pages', name), 'utf8');
    for (const figure of html.matchAll(/<figure[\s>][\s\S]*?<\/figure>/g)) {
      const caption = (figure[0].match(/<figcaption[\s>]([\s\S]*?)<\/figcaption>/) ?? ['', ''])[1];
      if (!caption.includes('tag--illustration')) continue;
      assert.match(
        caption,
        /tag--coming/,
        `${name} shows a mockup without saying it is coming: ${caption.trim().slice(0, 60)}`,
      );
    }
  }
});

test('WEIGHT: every picture is inside the budget for what it is', async () => {
  // 400 KB for a still, at either density; 3 MB for a loop. The owner's report
  // was that the pictures loaded slowly and that some never arrived, so the
  // ceiling is on every file the site serves and not on a list of them.
  const { BUDGET } = await import('../../site/build.mjs');
  assert.ok(BUDGET.still <= 400 * 1024, 'the budget for a still was raised');
  assert.ok(BUDGET.loop <= 3 * 1024 * 1024, 'the budget for a loop was raised');
  let checked = 0;
  for (const file of walk(path.join(out, 'media'), ['.png', '.gif'])) {
    const size = fs.statSync(file).size;
    const budget = file.endsWith('.gif') ? BUDGET.loop : BUDGET.still;
    checked++;
    assert.ok(
      size <= budget,
      `media/${path.basename(file)} is ${Math.round(size / 1024)} KB, over ` +
        `${Math.round(budget / 1024)} KB`,
    );
  }
  assert.ok(checked > 30, 'expected the site to carry pictures');
});

test('WEIGHT: no page costs more than its budget, read to the bottom', async () => {
  // Measured the expensive way: a dense screen, so the `@2x` file of every
  // pair, with every lazy picture and every loop on the page.
  const { PAGES, BUDGET, pageWeight } = await import('../../site/build.mjs');
  assert.ok(BUDGET.page.default <= 3 * 1024 * 1024, 'the page budget was raised');
  assert.ok(BUDGET.page['index.html'] <= 2.5 * 1024 * 1024, 'the home budget was raised');
  for (const page of PAGES) {
    const rel = `${page.slug}.html`;
    const bytes = pageWeight(out, rel, { dpr: 2, all: true });
    const budget = BUDGET.page[rel] ?? BUDGET.page.default;
    assert.ok(
      bytes <= budget,
      `${rel} weighs ${Math.round(bytes / 1024)} KB, over its ${Math.round(budget / 1024)} KB budget`,
    );
    // And an ordinary screen never pays more than a dense one.
    assert.ok(pageWeight(out, rel, { dpr: 1, all: true }) <= bytes, `${rel}: 1x outweighs 2x`);
  }
});

test('MOTION: every loop moves, at twenty frames a second or more', () => {
  // A GIF with one frame is a PNG that costs more, and it is what a capture
  // pipeline produces when the floor was not animating. Counting frames means
  // counting graphic control extensions: `21 F9 04`, then a flags byte and the
  // frame's delay in hundredths of a second. Five hundredths is 20 fps.
  let checked = 0;
  for (const file of walk(path.join(out, 'media'), ['.gif'])) {
    const bytes = fs.readFileSync(file);
    const where = `media/${path.basename(file)}`;
    let frames = 0;
    let slowest = 0;
    for (let i = 0; i + 8 < bytes.length; i++) {
      // The whole block, to its terminator and the image descriptor after it,
      // so three matching bytes inside a frame's own data are not a frame.
      const block = bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04;
      if (block && bytes[i + 7] === 0x00 && bytes[i + 8] === 0x2c) {
        frames++;
        slowest = Math.max(slowest, bytes.readUInt16LE(i + 4));
      }
    }
    checked++;
    assert.ok(frames > 20, `${where} has ${frames} frame(s)`);
    assert.ok(slowest <= 5, `${where} holds a frame for ${slowest} hundredths of a second`);
    // Its first frame is beside it, for a reader who asked for less motion.
    assert.ok(fs.existsSync(file.replace(/\.gif$/, '.png')), `${where} has no still beside it`);
  }
  assert.ok(checked > 0, 'expected the site to carry a loop');

  // And a page that shows a loop offers that still under reduced motion.
  for (const page of walk(out, ['.html'])) {
    const html = fs.readFileSync(page, 'utf8');
    for (const m of html.matchAll(/<img\b[^>]*\ssrc="(media\/[\w-]+)\.gif"[^>]*>/g)) {
      const still = `<picture><source media="(prefers-reduced-motion: reduce)" srcset="${m[1]}.png" />`;
      assert.ok(
        html.includes(still + m[0]),
        `${path.relative(out, page)} plays ${m[1]}.gif whatever the reader asked for`,
      );
    }
  }
});

test('WEIGHT: every picture below the fold is lazy, on every page', () => {
  for (const page of walk(out, ['.html'])) {
    const html = fs.readFileSync(page, 'utf8');
    const where = path.relative(out, page);
    const tags = [...html.matchAll(/<img\b[^>]*>/g)]
      .map((m) => m[0])
      .filter((tag) => /\ssrc="(\.\.\/)*media\//.test(tag));
    // The first picture on a page is what the reader came for and is fetched
    // at once; everything under it waits until they scroll to it.
    for (const tag of tags.slice(1)) {
      assert.match(tag, /loading="lazy"/, `${where}: a picture below the fold is not lazy: ${tag}`);
    }
  }
});

/* ------------------------------------------------------------------ WP-94c */

/**
 * One declaration block's custom properties, by the selector that opens it.
 * The three token blocks in `site/style.css` contain no nested braces, so the
 * first `}` after the selector is the end of the block.
 *
 * @param {string} css @param {string} selector
 * @returns {Record<string, string>}
 */
function tokensOf(source, selector) {
  // Comments first: `site/style.css` writes the measured ratio beside most of
  // these values, and a `#hex` inside a comment is not a declaration.
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const at = css.indexOf(selector);
  assert.notEqual(at, -1, `${selector} is not in the stylesheet`);
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  /** @type {Record<string, string>} */
  const out_ = {};
  for (const m of css.slice(open, close).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    out_[m[1]] = m[2].trim();
  }
  return out_;
}

/** WCAG 2.x relative luminance of a `#rrggbb`. @param {string} hex */
function luminance(hex) {
  const channels = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** @param {string} a @param {string} b */
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The one block that carries the palette. The site has one look, the
 * product's own dark chrome, and is deliberately not offered in a second.
 */
const SCHEME_BLOCKS = [{ name: 'the one scheme', selector: '\n:root {' }];

/** Every token the scheme has to define, or it is not a complete scheme. */
const REQUIRED_TOKENS = [
  '--bg',
  '--bg-2',
  '--surface',
  '--surface-2',
  '--line',
  '--line-2',
  '--ink',
  '--ink-2',
  '--muted',
  '--accent',
  '--on-accent',
  '--crimson',
  '--on-crimson',
  '--head-solid',
];

/**
 * The grounds this site sets text on, and the inks it sets on them.
 * `--head-solid` is in here because the sticky bar is a ground for the nav.
 */
const GROUNDS = ['--bg', '--bg-2', '--surface', '--surface-2', '--head-solid'];
const INKS = ['--ink', '--ink-2', '--muted', '--accent'];

test('the token set is one set, in one scheme, and it is the app’s', () => {
  const css = fs.readFileSync(path.join(out, 'style.css'), 'utf8');
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const t = tokensOf(css, SCHEME_BLOCKS[0].selector);
  for (const name of REQUIRED_TOKENS) {
    assert.ok(t[name], `the scheme does not define ${name}`);
    assert.match(t[name], /^#[0-9a-f]{6}$/i, `${name} is ${t[name]}`);
  }

  // One scheme, on purpose. A second set of colours for the same pictures was
  // the thing being done badly; a stylesheet that grows one back fails here.
  assert.ok(!/prefers-color-scheme/.test(code), 'the stylesheet answers to a colour scheme');
  assert.ok(!/\[data-theme/.test(code), 'the stylesheet carries a second theme');
  for (const page of walk(out, ['.html'])) {
    const html = fs.readFileSync(page, 'utf8');
    assert.match(html, /<meta name="color-scheme" content="dark" \/>/);
    assert.ok(!/theme-toggle/.test(html), `${path.relative(out, page)} carries a scheme toggle`);
  }

  // The neutrals and the two accents are the app's own values, so the page
  // around a screenshot is the colour of the chrome inside it.
  const app = fs.readFileSync(path.join(root, 'public', 'style.css'), 'utf8');
  const product = tokensOf(app, ':root {');
  for (const name of [
    '--bg',
    '--surface',
    '--surface-2',
    '--line',
    '--line-2',
    '--ink',
    '--ink-2',
    '--muted',
  ]) {
    assert.equal(t[name], product[name], `${name} is not the app's`);
  }
  assert.equal(t['--crimson'], product['--accent'], 'crimson is not the app’s "for review" red');

  // No colour is written out where a token exists: outside the token block
  // the only raw colours are the shadows.
  const after = code.slice(code.indexOf('}', code.indexOf('\n:root {')));
  assert.deepEqual(
    after.match(/#[0-9a-f]{3,8}\b/gi) ?? [],
    [],
    'a raw hex colour outside the tokens',
  );

  // The whole scale and grid are on one root, so a page cannot invent a
  // seventh type step or a spacing value off the eight-pixel grid.
  for (const step of ['--t-display', '--t-title', '--t-head', '--t-sub', '--t-lede', '--t-body']) {
    assert.ok(t[step], `the scale has no ${step}`);
  }
  for (const [i, space] of ['--s-1', '--s-2', '--s-3', '--s-4', '--s-5'].entries()) {
    assert.ok(t[space], `the grid has no ${space}`);
    const rem = Number(t[space].replace('rem', ''));
    assert.equal(rem * 16, [8, 16, 24, 32, 48][i], `${space} is ${t[space]}`);
  }

  // The display step never shouts. `clamp(min, fluid, max)`; the max is what a
  // 1440 px window gets.
  const max = t['--t-display'].match(/,\s*([\d.]+)rem\s*\)/);
  assert.ok(max, `--t-display is not a clamp with a rem maximum: ${t['--t-display']}`);
  assert.ok(Number(max[1]) * 16 <= 96, `the display step tops out at ${Number(max[1]) * 16} px`);
  assert.ok(Number(max[1]) * 16 >= 64, `the display step tops out at ${Number(max[1]) * 16} px`);

  // No web font: the two families are named and never loaded.
  assert.match(t['--sans'], /system-ui/);
  assert.match(t['--mono'], /ui-monospace/);
});

test('ACCESSIBILITY: every ink clears 4.5:1 on every ground', () => {
  const css = fs.readFileSync(path.join(out, 'style.css'), 'utf8');
  let checked = 0;
  for (const block of SCHEME_BLOCKS) {
    const t = tokensOf(css, block.selector);
    for (const ground of GROUNDS) {
      for (const ink of INKS) {
        const ratio = contrast(t[ink], t[ground]);
        checked++;
        assert.ok(
          ratio >= 4.5,
          `${block.name}: ${ink} ${t[ink]} on ${ground} ${t[ground]} is ${ratio.toFixed(2)}:1`,
        );
      }
    }

    // What sits ON the two filled colours, rather than beside them.
    for (const [on, fill] of [
      ['--on-accent', '--accent'],
      ['--on-crimson', '--crimson'],
    ]) {
      const ratio = contrast(t[on], t[fill]);
      checked++;
      assert.ok(
        ratio >= 4.5,
        `${block.name}: ${on} ${t[on]} on ${fill} ${t[fill]} is ${ratio.toFixed(2)}:1`,
      );
    }

    // The focus ring is `--accent`, and `outline-offset` puts it on the ground
    // around the element, so the grounds above are the ones it has to hold.
    // 3:1 is the floor for a non-text indicator.
    for (const ground of GROUNDS) {
      const ratio = contrast(t['--accent'], t[ground]);
      checked++;
      assert.ok(ratio >= 3, `${block.name}: the focus ring on ${ground} is ${ratio.toFixed(2)}:1`);
    }
  }
  assert.equal(checked, 27, `expected every pair to be measured; measured ${checked}`);

  // Crimson is "for review". It clears 4.5:1 on nothing here, so it sets no
  // words: it is a fill and a dot, with neutral ink on top. Nor does any state
  // colour, which appears once, as a dot in the key that explains it.
  assert.ok(!/\bcolor:\s*var\(--crimson\)/.test(css), 'the stylesheet sets text in the crimson');
  assert.ok(!/\bcolor:\s*var\(--state-/.test(css), 'the stylesheet sets text in a state colour');
  assert.match(css, /:focus-visible \{[^}]*outline: 2px solid var\(--accent\)/, 'no focus ring');
  assert.match(css, /prefers-reduced-motion: reduce/, 'reduced motion is not answered');
});

test('the stylesheet and the script stay inside their budgets', () => {
  // The stylesheet as it is served: two source files, joined by the build.
  const css = fs.statSync(path.join(out, 'style.css')).size;
  const sources = STYLE_SOURCES.map((name) => fs.readFileSync(path.join(siteDir, name), 'utf8'));
  assert.equal(fs.readFileSync(path.join(out, 'style.css'), 'utf8'), sources.join('\n'));
  for (const [i, text] of sources.entries()) {
    const lines = text.split('\n').length;
    assert.ok(
      lines <= 900,
      `site/${STYLE_SOURCES[i]} is ${lines} lines, over the 900-line ceiling`,
    );
  }
  const js = fs.statSync(path.join(siteDir, 'site.js')).size;
  assert.ok(css <= 32 * 1024, `style.css is ${(css / 1024).toFixed(1)} KB, over 32 KB`);
  assert.ok(js <= 6 * 1024, `site.js is ${(js / 1024).toFixed(1)} KB, over 6 KB`);
});

test('every page carries the skip link, the nav and the menu', () => {
  for (const page of walk(out, ['.html'])) {
    const html = fs.readFileSync(page, 'utf8');
    const where = path.relative(out, page);
    assert.match(html, /<a class="skip-link" href="#main">/, `${where} has no skip link`);
    assert.match(html, /<main id="main">/, `${where} has nothing for the skip link to reach`);
    assert.match(html, /<nav class="site-nav" aria-label="Sections">/, `${where} has no nav`);
    // Five links fit on the bar. Under 48rem the row collapses into a
    // `<details>` menu, which is why the site navigates with scripting off.
    assert.ok(!/nav-more/.test(html), `${where} still carries the More group`);
    assert.match(html, /<details class="nav-toggle">/, `${where} has no narrow-screen menu`);
    for (const nav of ['Features', 'Look', 'Install', 'Privacy', 'FAQ']) {
      assert.match(html, new RegExp(`>${nav}</a>`), `${where} does not navigate to ${nav}`);
    }
    assert.match(html, /<footer class="site-foot">/, `${where} has no footer`);
    assert.match(html, /changelog\.html">Changelog<\/a>/, `${where} does not link the changelog`);
  }
});

test('every page has a title, a description and a card of its own', async () => {
  const { PAGES, PREVIEW, SITE_ORIGIN, imageSize } = await import('../../site/build.mjs');
  const titles = new Set();
  const descriptions = new Set();
  for (const page of PAGES) {
    const html = fs.readFileSync(path.join(out, `${page.slug}.html`), 'utf8');
    const where = `${page.slug}.html`;
    const title = (html.match(/<title>([^<]+)<\/title>/) ?? [])[1];
    const description = (html.match(/<meta name="description" content="([^"]+)"/) ?? [])[1];
    assert.ok(title && title.length >= 10 && title.length <= 80, `${where}: title "${title}"`);
    assert.ok(description, `${where} has no description`);
    assert.ok(
      description.length >= 60 && description.length <= 170,
      `${where}: a description of ${description.length} characters`,
    );
    assert.ok(!titles.has(title), `${where} shares its title`);
    assert.ok(!descriptions.has(description), `${where} shares its description`);
    titles.add(title);
    descriptions.add(description);

    for (const tag of ['og:title', 'og:description', 'og:url', 'og:image', 'og:image:alt']) {
      assert.match(html, new RegExp(`<meta property="${tag}" content="[^"]+"`), `${where}: ${tag}`);
    }
    assert.match(html, /<meta name="twitter:card" content="summary_large_image" \/>/);
    assert.ok(
      html.includes(`<meta name="twitter:image" content="${SITE_ORIGIN}/media/${PREVIEW}"`),
      `${where}: no card picture`,
    );
    assert.match(html, /<link rel="icon" href="deckhq-mark\.svg" type="image\/svg\+xml" \/>/);
    // A page that can be found says where it lives; the 404 page says not to.
    // (In `og:url`, not a `<link rel="canonical">`: no `<link>` here is absolute.)
    if (page.unlisted) assert.match(html, /<meta name="robots" content="noindex" \/>/);
    const address = page.slug === 'index' ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}/${page.slug}.html`;
    assert.ok(html.includes(`<meta property="og:url" content="${address}" />`), `${where}: og:url`);
  }

  // The card is 1200 x 630, and it is on the site at the address the tags name.
  assert.deepEqual(imageSize(path.join(out, 'media', PREVIEW)), { width: 1200, height: 630 });

  // The sitemap lists every page a reader should find, and nothing else.
  const listed = fs.readFileSync(path.join(out, 'sitemap.txt'), 'utf8').trim().split('\n');
  assert.equal(listed.length, PAGES.filter((p) => !p.unlisted).length);
  for (const url of listed) {
    assert.ok(url.startsWith(`${SITE_ORIGIN}/`), `the sitemap lists ${url}`);
    const rel = url.slice(SITE_ORIGIN.length + 1) || 'index.html';
    assert.ok(fs.existsSync(path.join(out, rel)), `the sitemap lists ${rel}, which was not built`);
  }
  assert.match(
    fs.readFileSync(path.join(out, 'robots.txt'), 'utf8'),
    /^Sitemap: https:\/\/dkpanseriya\.github\.io\/deckhq\/sitemap\.txt$/m,
  );
});

test('SECURITY: no file in the built site names another host', () => {
  // The pages are held to this above. This is everything else a browser or a
  // crawler can open: the stylesheet, the script, the sitemap and robots.txt.
  // (The two installers are the repository's own files and say where Node
  // comes from; they are checked byte for byte, and are not this site's words.)
  for (const file of walk(out, ['.css', '.js', '.txt', '.svg'])) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/(?:https?:)?\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi)) {
      const host = m[1].toLowerCase();
      if (host === SELF || host === 'www.w3.org') continue;
      assert.fail(`${path.relative(out, file)} names ${host}`);
    }
  }
  // And nothing in the stylesheet or the script is fetched at all.
  const css = fs.readFileSync(path.join(out, 'style.css'), 'utf8');
  assert.ok(!/url\(/i.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'the stylesheet fetches a file');
});

test('the page works with its script removed', () => {
  // The JavaScript-off reading of every page: strip the script element, and
  // what is left has to be the whole page. Two things could break that: an
  // element hidden in the markup and un-hidden by the script, and a rule that
  // hides content until the script arrives. Both are asserted.
  const css = fs.readFileSync(path.join(out, 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  // Nothing waits for a scroll to appear: there is no reveal on this site.
  assert.ok(!/data-reveal|js-reveal/.test(css), 'the stylesheet carries a scroll reveal');
  // A rule may hide something only in the state the script itself sets
  // (`.is-live`), or to swap the bar for the menu at a narrow width.
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [, selector, body] = m;
    if (!/display:\s*none|visibility:\s*hidden|opacity:\s*0(\.0+)?\s*;/.test(body)) continue;
    assert.match(
      selector,
      /\.is-live|\.site-nav|\.nav-toggle|details-marker/,
      `"${selector.trim()}" hides content without waiting for the script`,
    );
  }
  // An entrance may move a picture. It may not start it transparent, because
  // an animation that never runs would leave it that way.
  for (const m of css.matchAll(/@keyframes\s+[\w-]+\s*\{([\s\S]*?\})\s*\}/g)) {
    assert.ok(!/opacity/.test(m[1]), 'a keyframe animates opacity');
  }

  for (const page of walk(out, ['.html'])) {
    const html = fs.readFileSync(page, 'utf8');
    const where = path.relative(out, page);
    const withoutScripts = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    const body = withoutScripts.slice(
      withoutScripts.indexOf('<main id="main">'),
      withoutScripts.indexOf('</main>'),
    );
    assert.ok(body.length > 200, `${where} has almost nothing between its main tags`);

    // Nothing is hidden in the markup, and the script is not what writes the
    // words: every button it adds is one the page reads complete without.
    assert.ok(!/<\w+[^>]*\shidden(?:[=\s>])/.test(withoutScripts), `${where} hides an element`);
    assert.ok(
      !/style="[^"]*(display\s*:\s*none|opacity\s*:\s*0|visibility\s*:\s*hidden)/i.test(html),
      `${where} hides something with an inline style`,
    );
    assert.ok(!/\sstyle="/.test(body), `${where} carries an inline style`);
    assert.equal((html.match(/<script\b/g) ?? []).length, 1, `${where}: one script, deferred`);
    assert.match(html, /<script src="site\.js" defer><\/script>/);
  }
});

test('the home page leads with the floor, and every band picture is lazy', async () => {
  const { imageSize } = await import('../../site/build.mjs');
  const home = fs.readFileSync(path.join(out, 'index.html'), 'utf8');

  // The first picture a stranger sees is the whole window on a fixture floor.
  const first = home.match(/<img[^>]*\ssrc="(media\/[^"]+)"/);
  assert.ok(first, 'the home page shows no picture from the media directory');
  assert.equal(first[1], 'media/hero.png', `the hero is ${first[1]}`);

  // The hero is preloaded, at the density the screen has, and is the one
  // picture that is not lazy; everything under it waits for the scroll.
  // A narrow screen gets a closer crop of the same window, and its own hint,
  // so a phone is not sent the whole floor to show at the size of a stamp.
  for (const [name, media] of [
    ['hero', '(min-width: 40rem)'],
    ['hero-phone', '(max-width: 39.99rem)'],
  ]) {
    assert.ok(
      home.includes(
        `<link rel="preload" as="image" href="media/${name}.png" imagesrcset="media/${name}.png 1x, ` +
          `media/${name}@2x.png 2x" media="${media}" fetchpriority="high" />`,
      ),
      `${name} is not preloaded`,
    );
  }
  assert.match(
    home,
    /<picture><source media="\(max-width: 39\.99rem\)" srcset="media\/hero-phone\.png 1x, media\/hero-phone@2x\.png 2x" width="\d+" height="\d+" \/><img\b/,
    'the hero has no closer crop for a narrow screen',
  );
  assert.ok(!/data-narrow/.test(home), 'an authoring attribute reached the page');
  const images = [...home.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
  const fromMedia = images.filter((tag) => /\ssrc="media\//.test(tag));
  assert.ok(
    fromMedia.length >= 10,
    `expected the home page to carry pictures; found ${fromMedia.length}`,
  );
  assert.ok(!/loading="lazy"/.test(fromMedia[0]), 'the hero picture is lazy');
  assert.match(fromMedia[0], /fetchpriority="high"/, 'the hero picture is not asked for first');
  for (const tag of fromMedia.slice(1)) {
    assert.match(
      tag,
      /loading="lazy"/,
      `a picture below the fold is not lazy: ${tag.slice(0, 80)}`,
    );
  }

  // Every picture carries its own dimensions, so nothing moves while it loads;
  // decodes off the main thread; and offers its dense file when it has one.
  let pairs = 0;
  for (const page of walk(out, ['.html'])) {
    const html = fs.readFileSync(page, 'utf8');
    for (const tag of html.matchAll(/<img\b[^>]*>/g)) {
      const src = (tag[0].match(/\ssrc="([^"]+)"/) ?? ['', ''])[1];
      if (!/(^|\/)media\//.test(src)) continue;
      const where = path.relative(out, page);
      assert.match(tag[0], /\swidth="\d+"/, `${where} shows ${src} with no width`);
      assert.match(tag[0], /\sheight="\d+"/, `${where} shows ${src} with no height`);
      assert.match(tag[0], /\sdecoding="async"/, `${where} decodes ${src} on the main thread`);
      const size = imageSize(path.resolve(path.dirname(page), src));
      assert.ok(size, `${where}: ${src} cannot be measured`);
      assert.equal(
        `${(tag[0].match(/\swidth="(\d+)"/) ?? [])[1]}x${(tag[0].match(/\sheight="(\d+)"/) ?? [])[1]}`,
        `${size.width}x${size.height}`,
        `${where} declares the wrong size for ${src}`,
      );
      const dense = src.replace(/\.png$/, '@2x.png');
      if (src.endsWith('.png') && fs.existsSync(path.resolve(path.dirname(page), dense))) {
        pairs++;
        assert.ok(
          tag[0].includes(` srcset="${src} 1x, ${dense} 2x"`),
          `${where} does not offer ${dense} to a dense screen`,
        );
      }
    }
  }
  assert.ok(pairs > 30, `expected most pictures to come as a pair; found ${pairs}`);
});

test('what a reader downloads before scrolling the home page', async () => {
  // The document, the stylesheet, the script, the mark, and the one picture
  // that is not lazy, on a dense screen. 600 KB; it was 1.5 MB.
  const { BUDGET, pageWeight } = await import('../../site/build.mjs');
  assert.ok(BUDGET.firstView <= 600 * 1024, 'the first-view budget was raised');
  const bytes = pageWeight(out, 'index.html', { dpr: 2, all: false });
  assert.ok(
    bytes <= BUDGET.firstView,
    `the home page's first view is ${(bytes / 1024).toFixed(0)} KB, over 600 KB`,
  );
  // And read to the bottom with every loop playing, it is under 3 MB.
  const whole = pageWeight(out, 'index.html', { dpr: 2, all: true });
  assert.ok(whole <= 3 * 1024 * 1024, `the home page is ${(whole / 1024).toFixed(0)} KB`);
});

test('the deployment workflow builds the site it deploys', () => {
  const yml = fs.readFileSync(path.join(root, '.github', 'workflows', 'pages.yml'), 'utf8');
  assert.match(yml, /node site\/build\.mjs/, 'the workflow runs the build');
  assert.match(yml, /path:\s*site\/dist/, 'the workflow uploads what the build wrote');
  assert.match(yml, /branches:\s*\[main\]/, 'the workflow deploys from main');
});
