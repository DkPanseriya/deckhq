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
    // WP-94c · the two scripts. Everything they do, the page does without
    // them; `site/site.js`'s header says which four things they are.
    'theme.js',
    'site.js',
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

test('SECURITY: the scripts fetch nothing, store nothing but the scheme', () => {
  // The same promise, applied to the two files WP-94c added. They are the only
  // JavaScript on this site; if either one ever reached the network, the
  // sentence in every page footer would be false.
  for (const name of ['theme.js', 'site.js']) {
    for (const file of [path.join(siteDir, name), path.join(out, name)]) {
      const text = fs.readFileSync(file, 'utf8');
      assert.ok(
        !/\b(fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts)\b/.test(
          text,
        ),
        `${name} makes a request`,
      );
      assert.ok(!/https?:\/\//.test(text), `${name} names an absolute URL`);
      for (const m of text.matchAll(/localStorage\.\w+\(\s*'([^']+)'/g)) {
        assert.equal(m[1], 'deckhq-theme', `${name} stores ${m[1]}`);
      }
    }
    assert.deepEqual(
      fs.readFileSync(path.join(siteDir, name)),
      fs.readFileSync(path.join(out, name)),
      `${name} on the site is not the file in the repository`,
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
  // Four, not the eight WP-94a had: since WP-94b a mockup is published only
  // where it draws something that is COMING, and the design-journey sheets —
  // the candidates, the material board, the interior before-and-after — are
  // off the site entirely.
  assert.ok(shown >= 4, `expected the mockups to be published; found ${shown}`);

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
  const { ROLES } = await import('../../site/build.mjs');
  const MAX_IMAGE_WIDTH = Math.max(...Object.values(ROLES).map((r) => r.width));
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
  const { IMAGES, ROLES } = await import('../../site/build.mjs');
  let checked = 0;
  for (const image of IMAGES) {
    const file = path.join(out, 'media', image.to);
    if (!fs.existsSync(file)) continue;
    const role = ROLES[image.role ?? (image.to.endsWith('.gif') ? 'gif' : 'crop')];
    const size = fs.statSync(file).size;
    checked++;
    assert.ok(
      size <= role.budget,
      `media/${image.to} is ${Math.round(size / 1024)} KB, over the ` +
        `${Math.round(role.budget / 1024)} KB budget for a ${image.role}`,
    );
  }
  assert.ok(checked > 10, 'expected the site to carry images');
});

test('WEIGHT: no page costs more than its budget, read to the bottom', async () => {
  const { PAGES, PAGE_BUDGET, pageWeight } = await import('../../site/build.mjs');
  for (const page of PAGES) {
    if (page.slug === 'log/index') continue;
    const rel = `${page.slug}.html`;
    const bytes = pageWeight(out, rel);
    const budget = PAGE_BUDGET[rel] ?? PAGE_BUDGET.default;
    assert.ok(
      bytes <= budget,
      `${rel} weighs ${Math.round(bytes / 1024)} KB, over its ${Math.round(budget / 1024)} KB budget`,
    );
  }
});

test('MOTION: every GIF the site serves actually moves', () => {
  // A GIF with one frame is a PNG that costs more, and it is what a capture
  // pipeline produces when the floor was not animating — which is the failure
  // mode worth a gate, because it looks right in a screenshot. Counting frames
  // means counting graphic control extensions: `21 F9 04`, the four-byte block
  // that carries each frame's delay.
  let checked = 0;
  for (const file of walk(path.join(out, 'media'), ['.gif'])) {
    const bytes = fs.readFileSync(file);
    let frames = 0;
    for (let i = 0; i + 3 < bytes.length; i++) {
      if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04) frames++;
    }
    checked++;
    assert.ok(
      frames > 1,
      `media/${path.relative(path.join(out, 'media'), file)} has ${frames} frame(s)`,
    );
  }
  assert.ok(checked > 0, 'expected the site to carry an animation');
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

/** The blocks that carry a complete palette, and what each one is. */
const SCHEME_BLOCKS = [
  { name: 'dark (the default, and the OS preference)', selector: '\n:root {' },
  { name: 'light (the OS preference)', selector: ":root:not([data-theme='dark']) {" },
  { name: 'light (the toggle)', selector: ":root[data-theme='light'] {" },
];

/** Every token a scheme has to define, or it is not a complete scheme. */
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
 * `--head-solid` is in here because the sticky bar is a ground for the nav
 * links whenever `backdrop-filter` is not available.
 */
const GROUNDS = ['--bg', '--bg-2', '--surface', '--surface-2', '--head-solid'];
const INKS = ['--ink', '--ink-2', '--muted', '--accent'];

test('the token set is one set, and every scheme defines all of it', () => {
  const css = fs.readFileSync(path.join(siteDir, 'style.css'), 'utf8');
  for (const block of SCHEME_BLOCKS) {
    const t = tokensOf(css, block.selector);
    for (const name of REQUIRED_TOKENS) {
      assert.ok(t[name], `${block.name} does not define ${name}`);
      assert.match(t[name], /^#[0-9a-f]{6}$/i, `${block.name}'s ${name} is ${t[name]}`);
    }
  }

  // The two light blocks are the same palette written twice — once for the OS
  // preference, once for the toggle. If they ever drift, one of them is a
  // scheme nobody designed.
  const byOs = tokensOf(css, SCHEME_BLOCKS[1].selector);
  const byToggle = tokensOf(css, SCHEME_BLOCKS[2].selector);
  for (const name of REQUIRED_TOKENS) {
    assert.equal(byToggle[name], byOs[name], `${name} differs between the two light blocks`);
  }

  // And the whole scale and grid are on one root, so a page cannot invent a
  // seventh type step or a spacing value off the eight-pixel grid.
  const root = tokensOf(css, SCHEME_BLOCKS[0].selector);
  for (const step of ['--t-display', '--t-title', '--t-head', '--t-sub', '--t-lede', '--t-body']) {
    assert.ok(root[step], `the scale has no ${step}`);
  }
  for (const [i, space] of ['--s-1', '--s-2', '--s-3', '--s-4', '--s-5'].entries()) {
    assert.ok(root[space], `the grid has no ${space}`);
    // 8, 16, 24, 32, 48 — every one a multiple of half a rem, which is 8 px.
    const rem = Number(root[space].replace('rem', ''));
    assert.equal(rem * 16, [8, 16, 24, 32, 48][i], `${space} is ${root[space]}`);
  }

  // The display step never shouts. `clamp(min, fluid, max)`; the max is what a
  // 1440 px window gets.
  const max = root['--t-display'].match(/,\s*([\d.]+)rem\s*\)/);
  assert.ok(max, `--t-display is not a clamp with a rem maximum: ${root['--t-display']}`);
  assert.ok(Number(max[1]) * 16 <= 96, `the display step tops out at ${Number(max[1]) * 16} px`);
  assert.ok(Number(max[1]) * 16 >= 64, `the display step tops out at ${Number(max[1]) * 16} px`);
});

test('ACCESSIBILITY: every ink clears 4.5:1 on every ground, in both schemes', () => {
  const css = fs.readFileSync(path.join(siteDir, 'style.css'), 'utf8');
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
    // AROUND the element rather than on the element, so the grounds above are
    // the ones it has to hold. 3:1 is the floor for a non-text indicator.
    // Crimson is deliberately not in this list: nothing focusable on this site
    // sits on it, because crimson is a 2 px dash and a dot and never a
    // control.
    for (const ground of GROUNDS) {
      const ratio = contrast(t['--accent'], t[ground]);
      checked++;
      assert.ok(ratio >= 3, `${block.name}: the focus ring on ${ground} is ${ratio.toFixed(2)}:1`);
    }
  }
  assert.ok(checked >= 60, `expected every pair to be measured; measured ${checked}`);

  // `public/style.css`'s rule, applied here: crimson is `for_review`, it clears
  // 4.5:1 on nothing in the dark scheme, and it therefore sets no words. It is
  // a fill, a dot and a rule, with neutral ink on top.
  assert.ok(!/\bcolor:\s*var\(--crimson\)/.test(css), 'the stylesheet sets text in the crimson');
});

test('the stylesheet and the scripts stay inside their budgets', () => {
  const css = fs.statSync(path.join(siteDir, 'style.css')).size;
  const js =
    fs.statSync(path.join(siteDir, 'theme.js')).size +
    fs.statSync(path.join(siteDir, 'site.js')).size;
  assert.ok(css <= 40 * 1024, `style.css is ${(css / 1024).toFixed(1)} KB, over 40 KB`);
  assert.ok(js <= 10 * 1024, `the scripts are ${(js / 1024).toFixed(1)} KB, over 10 KB`);
});

test('every page carries the skip link, the nav and both menus', () => {
  for (const page of walk(out, ['.html'])) {
    const html = fs.readFileSync(page, 'utf8');
    const where = path.relative(out, page);
    assert.match(html, /<a class="skip-link" href="#main">/, `${where} has no skip link`);
    assert.match(html, /<main id="main">/, `${where} has nothing for the skip link to reach`);
    assert.match(html, /<nav class="site-nav" aria-label="Sections">/, `${where} has no nav`);
    // The wide bar's "More" group and the narrow bar's whole menu. Both are
    // `<details>`, which is the reason the site navigates with scripting off.
    assert.match(html, /<details class="nav-more">/, `${where} has no More group`);
    assert.match(html, /<details class="nav-toggle">/, `${where} has no narrow-screen menu`);
    assert.match(html, /<footer class="site-foot">/, `${where} has no footer`);
  }
});

test('the page works with its scripts removed', () => {
  // The JavaScript-off reading of every page: strip the script elements, and
  // what is left has to be the whole page. Two things could break that — an
  // element hidden in the markup and un-hidden by a script, and a reveal whose
  // hidden state is in the stylesheet rather than behind the root class the
  // script sets — so both are asserted rather than assumed.
  const css = fs.readFileSync(path.join(siteDir, 'style.css'), 'utf8');

  // The reveal's zero-opacity rule exists ONLY under `:root.js-reveal`.
  for (const m of css.matchAll(/([^{}]*\[data-reveal\][^{}]*)\{([^}]*)\}/g)) {
    const [, selector, body] = m;
    if (!/opacity\s*:\s*0\b/.test(body)) continue;
    assert.match(
      selector,
      /:root\.js-reveal/,
      `a reveal is hidden by "${selector.trim()}", which does not wait for the script`,
    );
  }
  assert.match(css, /:root\.js-reveal \[data-reveal\]/, 'the reveal is not gated on the script');

  for (const page of walk(out, ['.html'])) {
    const html = fs.readFileSync(page, 'utf8');
    const where = path.relative(out, page);
    const withoutScripts = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');

    // Every word of the body survives the removal: nothing on these pages is
    // written by a script.
    const body = withoutScripts.slice(
      withoutScripts.indexOf('<main id="main">'),
      withoutScripts.indexOf('</main>'),
    );
    assert.ok(body.length > 200, `${where} has almost nothing between its main tags`);

    // The only `hidden` attribute on the site is the scheme toggle, which is a
    // control that does nothing without a script and is therefore absent
    // without one. Anything else hidden in the markup would be content a
    // reader with scripting off never sees.
    for (const tag of withoutScripts.matchAll(/<(\w+)[^>]*\shidden(?:[=\s>])[^>]*>/g)) {
      assert.match(
        tag[0],
        /class="theme-toggle"/,
        `${where} hides ${tag[1]} in the markup: ${tag[0]}`,
      );
    }
    assert.match(
      html,
      /<button class="theme-toggle" type="button" hidden/,
      `${where} ships a scheme toggle that does nothing without a script`,
    );

    // And nothing on a page depends on an inline style to be visible.
    assert.ok(
      !/style="[^"]*(display\s*:\s*none|opacity\s*:\s*0|visibility\s*:\s*hidden)/i.test(html),
      `${where} hides something with an inline style`,
    );
  }
});

test('the home page leads with the golden, and every band picture is lazy', async () => {
  const { imageSize } = await import('../../site/build.mjs');
  const home = fs.readFileSync(path.join(out, 'index.html'), 'utf8');

  // The first picture a stranger sees is the one CI re-checks every run —
  // WP-94a's rule, kept.
  const first = home.match(/<img[^>]*\ssrc="(media\/[^"]+)"/);
  assert.ok(first, 'the home page shows no picture from the media directory');
  assert.equal(first[1], 'media/goldens/three.png', `the hero is ${first[1]}`);

  // The hero is eager and everything under it is lazy, so what a reader pays
  // for above the fold is one picture.
  const images = [...home.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
  const fromMedia = images.filter((tag) => /\ssrc="media\//.test(tag));
  assert.ok(
    fromMedia.length >= 6,
    `expected the home page to carry pictures; found ${fromMedia.length}`,
  );
  assert.ok(!/loading="lazy"/.test(fromMedia[0]), 'the hero picture is lazy');
  for (const tag of fromMedia.slice(1)) {
    assert.match(
      tag,
      /loading="lazy"/,
      `a picture below the fold is not lazy: ${tag.slice(0, 80)}`,
    );
  }

  // Every picture carries its own dimensions, so nothing on the page moves
  // while it loads. WP-94c's `addImageDimensions()` puts them there from the
  // file itself, which is why this holds on every page and not only this one.
  for (const page of walk(out, ['.html'])) {
    const html = fs.readFileSync(page, 'utf8');
    for (const tag of html.matchAll(/<img\b[^>]*>/g)) {
      const src = (tag[0].match(/\ssrc="([^"]+)"/) ?? ['', ''])[1];
      if (!/(^|\/)media\//.test(src)) continue;
      const where = path.relative(out, page);
      assert.match(tag[0], /\swidth="\d+"/, `${where} shows ${src} with no width`);
      assert.match(tag[0], /\sheight="\d+"/, `${where} shows ${src} with no height`);
      // And the number is the file's own, not a guess.
      const size = imageSize(path.resolve(path.dirname(page), src));
      if (!size) continue;
      assert.equal(
        `${(tag[0].match(/\swidth="(\d+)"/) ?? [])[1]}x${(tag[0].match(/\sheight="(\d+)"/) ?? [])[1]}`,
        `${size.width}x${size.height}`,
        `${where} declares the wrong size for ${src}`,
      );
    }
  }
});

test('what a reader downloads above the fold on the home page', () => {
  // The budget is 1.5 MB: the document, the stylesheet, the two scripts, the
  // mark, and the one picture that is not lazy. Everything else on the page is
  // below the fold and is fetched only if the reader goes there.
  const home = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  let bytes = Buffer.byteLength(home);
  for (const name of ['style.css', 'theme.js', 'site.js', 'deckhq-mark.png']) {
    bytes += fs.statSync(path.join(out, name)).size;
  }
  for (const tag of home.matchAll(/<img\b[^>]*>/g)) {
    if (/loading="lazy"/.test(tag[0])) continue;
    const src = (tag[0].match(/\ssrc="([^"]+)"/) ?? ['', ''])[1];
    if (!src.startsWith('media/')) continue;
    bytes += fs.statSync(path.join(out, src)).size;
  }
  assert.ok(
    bytes <= 1.5 * 1024 * 1024,
    `the home page's first screen is ${(bytes / 1024).toFixed(0)} KB, over 1.5 MB`,
  );
});

test('the deployment workflow builds the site it deploys', () => {
  const yml = fs.readFileSync(path.join(root, '.github', 'workflows', 'pages.yml'), 'utf8');
  assert.match(yml, /node site\/build\.mjs/, 'the workflow runs the build');
  assert.match(yml, /path:\s*site\/dist/, 'the workflow uploads what the build wrote');
  assert.match(yml, /branches:\s*\[main\]/, 'the workflow deploys from main');
});
