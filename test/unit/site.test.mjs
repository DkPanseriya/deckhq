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
    'model.html',
    'install.html',
    'hooks-and-privacy.html',
    'adapters.html',
    'faq.html',
    'log/index.html',
    'log/1.html',
    'style.css',
    'favicon.svg',
  ]) {
    assert.ok(fs.existsSync(path.join(out, rel)), `${rel} was not built`);
  }
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

test('the deployment workflow builds the site it deploys', () => {
  const yml = fs.readFileSync(path.join(root, '.github', 'workflows', 'pages.yml'), 'utf8');
  assert.match(yml, /node site\/build\.mjs/, 'the workflow runs the build');
  assert.match(yml, /path:\s*site\/dist/, 'the workflow uploads what the build wrote');
  assert.match(yml, /branches:\s*\[main\]/, 'the workflow deploys from main');
});
