/**
 * The documentation site, built with nothing.
 *
 *   node site/build.mjs                 # -> site/dist
 *   node site/build.mjs --out /tmp/x    # anywhere else
 *   node site/build.mjs --serve         # build, then serve site/dist on 4600
 *
 * There is no site generator here and there is no dependency to add one. The
 * pages in `site/pages/` are hand-written HTML bodies; this script wraps each
 * one in the shared shell, renders `docs/DEVIATIONS.md` into the engineering
 * log, and copies the images the pages reference out of `docs/media/`.
 *
 * The product makes no outbound network calls of any kind, and its site keeps
 * the same promise: every stylesheet, script, image and font on it is either
 * served from the site's own origin or is not there at all. There is no
 * analytics, no CDN, no web font and no third-party frame.
 * `test/unit/site.test.mjs` asserts that against the sources *and* against
 * what this script emits, so the promise cannot be broken by a build step.
 *
 * The markdown converter below is deliberately small: headings, paragraphs,
 * lists, tables, block quotes, rules, fenced code, and five inline forms.
 * Everything is escaped before anything is added, so a `<script>` inside a
 * deviation entry renders as the six visible characters it is.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from '../scripts/lib/png.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};
const OUT = path.resolve(opt('--out', path.join(here, 'dist')));
const SERVE = argv.includes('--serve');
const PORT = Number(opt('--port', 4600));

const REPO = 'https://github.com/DkPanseriya/deckhq';

/**
 * Where this site is served from, and therefore where the one-line installers
 * below are. A GitHub project page, so the repository name is part of the
 * path; there is no custom domain and this file must not invent one.
 */
const SITE_ORIGIN = 'https://dkpanseriya.github.io/deckhq';

/* ------------------------------------------------------------------ pages */

/**
 * The site's pages, in navigation order. `file` is a body fragment in
 * `site/pages/`; everything around it comes from `shell()`.
 */
const PAGES = [
  {
    slug: 'index',
    nav: 'Home',
    group: 'main',
    title: 'DeckHQ',
    description:
      'Every AI coding session on your machine, on one office floor. It sees the ones your ' +
      'terminal forgot, and it remembers what is waiting on you even after you have read it.',
  },
  {
    slug: 'features',
    nav: 'Features',
    group: 'main',
    title: 'Features',
    description:
      'The floor, the queue, the review card, permissions, token usage, pinning, app mode, ' +
      'notifications and themes — one picture each.',
  },
  {
    slug: 'look',
    nav: 'Look',
    group: 'main',
    title: 'The look',
    description:
      'The three themes that ship today, and the interior presets, control centre and agent ' +
      'sizes that WP-88 is designed to add.',
  },
  {
    slug: 'characters',
    nav: 'Characters',
    group: 'main',
    title: 'The characters',
    description:
      'The figure on the floor: what it is today, and the motion and crew sheets that WP-87 ' +
      'and WP-89 are designed against.',
  },
  {
    slug: 'studio',
    nav: 'Studio',
    group: 'main',
    title: 'Studio',
    description:
      'The idea-to-office loop: what exists today — the store, the consent and the planner — ' +
      'and the eight steps that do not.',
  },
  {
    slug: 'install',
    nav: 'Install',
    group: 'main',
    title: 'Install',
    description: 'npx, a global install, the Claude Code plugin, the VS Code extension.',
  },
  {
    slug: 'docs',
    nav: 'Docs',
    group: 'main',
    title: 'Documentation',
    description: 'Every document this project keeps, and what each one is for.',
  },
  {
    slug: 'model',
    nav: 'The model',
    group: 'more',
    title: 'The model in 60 seconds',
    description: 'The six states, and the one rule that decides what you owe.',
  },
  {
    slug: 'hooks-and-privacy',
    nav: 'Hooks and privacy',
    group: 'more',
    title: 'Hooks and privacy',
    description:
      'What DeckHQ reads, what it writes, what it asks you first, and where it sends it.',
  },
  {
    slug: 'adapters',
    nav: 'Adapters',
    group: 'more',
    title: 'Adapters',
    description: 'Which runtimes DeckHQ reads, how verified each one is, and how to add one.',
  },
  {
    slug: 'faq',
    nav: 'FAQ',
    group: 'more',
    title: 'FAQ',
    description: 'The questions this project is asked most, answered with what has been measured.',
  },
  {
    slug: 'log/index',
    nav: 'Engineering log',
    group: 'more',
    title: 'Engineering log',
    description: '',
  },
];

/**
 * The one-line installers as the pages and the README print them — WP-75,
 * WP-94a. One source, so the README test and the site test check the same
 * three strings and a change to either has to change this array.
 */
const INSTALL_COMMANDS = [
  'npx deckhq app',
  'irm https://dkpanseriya.github.io/deckhq/install.ps1 | iex',
  'curl -fsSL https://dkpanseriya.github.io/deckhq/install.sh | sh',
];

/* ------------------------------------------------------------------ media */

/**
 * Every image the hand-written pages may show, and what class it is — WP-94a.
 * The policy is `docs/MEDIA.md`:
 *
 *   `capture`       DeckHQ, running, photographed.
 *   `golden`        a real render of a fixture, taken by the goldens gate.
 *   `illustration`  a designer's mockup of a specification. NOT shipped code.
 *
 * `to` is the path under `dist/media/`; a page writes `media/<to>`. The class
 * is not decoration: `assertIllustrationsAreLabelled()` below refuses to build
 * a page that shows an illustration whose caption does not say so, because a
 * mockup presented as a screenshot is the same defect as an adapter claiming a
 * verification it has not had (`docs/ADAPTERS.md` §6).
 *
 * @type {ReadonlyArray<{to: string, from: string, class: 'capture'|'golden'|'illustration'}>}
 */
const IMAGES = [
  // Goldens: the only class whose currency is proved on every CI run.
  { to: 'goldens/three.png', from: 'test/goldens/win32/three.png', class: 'golden', role: 'hero' },
  { to: 'goldens/demo.png', from: 'test/goldens/win32/demo.png', class: 'golden', role: 'crop' },
  {
    to: 'goldens/pinned.png',
    from: 'test/goldens/win32/pinned.png',
    class: 'golden',
    role: 'crop',
  },
  {
    to: 'goldens/single.png',
    from: 'test/goldens/win32/single.png',
    class: 'golden',
    role: 'hero',
  },
  {
    to: 'goldens/demo-night-shift.png',
    from: 'test/goldens/win32/demo@night-shift.png',
    class: 'golden',
    role: 'crop',
  },
  {
    to: 'goldens/demo-blueprint.png',
    from: 'test/goldens/win32/demo@blueprint.png',
    class: 'golden',
    role: 'crop',
  },

  // Captures. Several are stale — taken before WP-79 gave the figure its
  // current form — and `docs/MEDIA.md` §4.2 lists every one for WP-94b.
  { to: 'hero.gif', from: 'docs/media/hero.gif', class: 'capture', role: 'gif' },
  { to: 'deck-view.png', from: 'docs/media/deck-view.png', class: 'capture', role: 'crop' },
  {
    to: 'panel-review-card.png',
    from: 'docs/media/panel-review-card.png',
    class: 'capture',
    role: 'crop',
  },
  {
    to: 'permission-card.png',
    from: 'docs/media/permission-card.png',
    class: 'capture',
    role: 'crop',
  },
  { to: 'app-window.png', from: 'docs/media/app-window.png', class: 'capture', role: 'crop' },
  {
    to: 'office-cleared.png',
    from: 'docs/media/office-cleared.png',
    class: 'capture',
    role: 'crop',
  },
  {
    to: 'wrapped-weekly.png',
    from: 'docs/media/wrapped-weekly.png',
    class: 'capture',
    role: 'crop',
  },

  // Illustrations. Every one of these is a drawing of a specification.
  {
    to: 'look/presets.png',
    from: 'docs/media/look/presets.png',
    class: 'illustration',
    role: 'crop',
  },
  {
    to: 'look/control-centre.png',
    from: 'docs/media/look/control-centre.png',
    class: 'illustration',
    role: 'crop',
  },
  {
    to: 'look/agent-sizes.png',
    from: 'docs/media/look/agent-sizes.png',
    class: 'illustration',
    role: 'crop',
  },
  {
    to: 'interior/board.png',
    from: 'docs/media/interior/board.png',
    class: 'illustration',
    role: 'hero',
  },
  {
    to: 'interior/mockup-default.png',
    from: 'docs/media/interior/mockup-default.png',
    class: 'illustration',
    role: 'hero',
  },
  {
    to: 'design/character-b.png',
    from: 'docs/media/design/character/B.png',
    class: 'illustration',
    role: 'hero',
  },
  {
    to: 'design/character-in-situ.png',
    from: 'docs/media/design/character/in-situ.png',
    class: 'illustration',
    role: 'hero',
  },
  {
    to: 'motion/life-sheet.png',
    from: 'docs/media/motion/life-sheet.png',
    class: 'illustration',
    role: 'crop',
  },
  {
    to: 'motion/lounge-activities.png',
    from: 'docs/media/motion/lounge-activities.png',
    class: 'illustration',
    role: 'crop',
  },
  { to: 'motion/crew.gif', from: 'docs/media/motion/crew.gif', class: 'illustration', role: 'gif' },
];

/**
 * The four directories under `docs/media/` that hold mockups rather than
 * photographs. Anything sourced from one of them is an illustration, whatever
 * the table above says — asserted at build time, so adding a row with the
 * wrong class fails rather than mislabelling a page.
 */
const ILLUSTRATION_DIRS = ['interior', 'look', 'motion', 'design'];

/** The words an illustration's caption has to carry. */
const ILLUSTRATION_LABEL = 'design illustration';

/**
 * What a picture is for, how wide it is served, and what it may weigh — WP-94b.
 *
 * The owner's report was that the pictures load slowly and that the ones on
 * Look do not arrive at all. Locally every one of them resolves, so the defect
 * is not a path: it is 6.3 MB of Features and 4.0 MB of Look going down a
 * connection that is not this machine's disk. So every image now declares the
 * role it plays, the role fixes the width it is served at — the widest the
 * layout ever shows it, doubled, and no more — and the weight it may reach.
 *
 * `hero`  a full-column picture; the page shows it at up to 600 CSS px.
 * `crop`  a detail of one feature, shown in a card or beside text.
 * `gif`   motion. Width is the pipeline's to set; the ceiling is the budget.
 *
 * The numbers are enforced twice: here, so a build cannot publish an image
 * over its budget, and in `test/unit/site.test.mjs`, so the gate says which
 * picture and by how much without anyone running the site.
 */
const ROLES = {
  hero: { width: 1100, budget: 600 * 1024 },
  crop: { width: 680, budget: 250 * 1024 },
  gif: { width: 1200, budget: 2.5 * 1024 * 1024 },
};

/** What a whole page may weigh: its document, its assets, and every picture on it. */
const PAGE_BUDGET = { 'index.html': 2 * 1024 * 1024, default: 3 * 1024 * 1024 };

/**
 * The one-line installers, copied to the root of the site — WP-75.
 *
 * They are served from here rather than from a raw GitHub URL because this is
 * the only URL that is stable, is under this project's control, and already
 * deploys: `.github/workflows/pages.yml` uploads `site/dist` whole on every
 * push to `main`, so a file written here is at
 * `https://dkpanseriya.github.io/deckhq/<name>` the moment the workflow is
 * green. `raw.githubusercontent.com/.../v1.3.0/...` would pin a tag, which
 * sounds better and is worse: the tag does not exist until the release is cut,
 * so the line printed in the README and on the site would 404 between the
 * merge and the tag, which is exactly when a stranger reads it.
 *
 * They are NOT in the npm tarball. `package.json`'s `files` does not carry
 * `scripts/`, and that is the point: the product has no runtime dependency on
 * either of them, and nothing in `src/` imports them.
 */
const INSTALLERS = [
  { name: 'install.ps1', from: path.join('scripts', 'install', 'install.ps1') },
  { name: 'install.sh', from: path.join('scripts', 'install', 'install.sh') },
];

/* ------------------------------------------------------------------ shell */

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * The two glyphs on the scheme toggle, drawn here rather than fetched. One is
 * shown at a time and which one says what pressing the button would do.
 */
const SUN = `<svg class="i-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2" /><path d="M12 2.4v2.4M12 19.2v2.4M2.4 12h2.4M19.2 12h2.4M5.2 5.2l1.7 1.7M17.1 17.1l1.7 1.7M18.8 5.2l-1.7 1.7M6.9 17.1l-1.7 1.7" /></svg>`;
const MOON = `<svg class="i-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 14.3A8.6 8.6 0 0 1 9.7 3.5a8.6 8.6 0 1 0 10.8 10.8Z" /></svg>`;

/**
 * @param {{ title: string, description: string, body: string, slug: string, depth?: number }} page
 */
function shell(page) {
  const up = '../'.repeat(page.depth ?? 0);
  const here_ = page.slug;
  // Two groups on one bar — WP-94a, kept by WP-94c. Twelve links in one flat
  // row is a list to read rather than a way around, so the product pages lead
  // and the reference pages sit behind one disclosure after them. Under 45rem
  // the whole thing collapses into a second disclosure, and both are
  // `<details>` elements, so the menu opens with scripting switched off.
  const link = (p, indent) => {
    const href = p.slug === 'index' ? `${up}index.html` : `${up}${p.slug}.html`;
    const current = p.slug === here_ || (p.slug === 'log/index' && here_.startsWith('log/'));
    return `${indent}<a href="${esc(href)}"${current ? ' aria-current="page"' : ''}>${esc(p.nav)}</a>`;
  };
  const group = (name) => PAGES.filter((p) => (p.group ?? 'main') === name);
  const main = group('main');
  const more = group('more');

  const nav =
    main.map((p) => link(p, '          ')).join('\n') +
    `
          <details class="nav-more">
            <summary>More</summary>
            <div class="nav-more-list">
${more.map((p) => link(p, '              ')).join('\n')}
            </div>
          </details>`;

  const drawer =
    main.map((p) => link(p, '            ')).join('\n') +
    '\n            <hr />\n' +
    more.map((p) => link(p, '            ')).join('\n');

  const full = page.slug === 'index' ? 'DeckHQ' : `${page.title} — DeckHQ`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(full)}</title>
    <meta name="description" content="${esc(page.description)}" />
    <!-- WP-94c · both schemes, from one token set. The page follows the
         reader's own preference, and the toggle on the bar overrides it in
         either direction. -->
    <meta name="color-scheme" content="dark light" />
    <link rel="stylesheet" href="${esc(up)}style.css" />
    <!-- WP-82 · the product mark. The favicon is the SVG, which carries both
         grounds and follows the reader's own colour-scheme preference — a tab
         strip belongs to the browser, not to this site. -->
    <link rel="icon" href="${esc(up)}deckhq-mark.svg" type="image/svg+xml" />
    <!-- The stored scheme, before the first paint. Two dozen lines, no
         network call, and the only script on this site that is not deferred.
         Everything the pages do without it is in site/site.js's header. -->
    <script src="${esc(up)}theme.js"></script>
    <script src="${esc(up)}site.js" defer></script>
  </head>
  <body>
    <a class="skip-link" href="#main">Skip to content</a>
    <header class="site-head">
      <a class="brand" href="${esc(up)}index.html">
        <img class="brand-mark" src="${esc(up)}deckhq-mark.png" alt="" width="22" height="22" />
        <span class="brand-name">DeckHQ</span>
      </a>
      <nav class="site-nav" aria-label="Sections">
${nav}
      </nav>
      <details class="nav-toggle">
        <summary aria-label="Sections">Menu</summary>
        <nav class="nav-drawer" aria-label="Sections">
${drawer}
        </nav>
      </details>
      <button class="theme-toggle" type="button" hidden aria-label="Switch colour scheme">
        ${SUN}${MOON}
      </button>
    </header>

    <main id="main">
${page.body.replace(/\n$/, '')}
    </main>

    <footer class="site-foot">
      <div class="foot-inner">
        <div>
          <p class="foot-pitch"><strong>DeckHQ</strong></p>
          <p>
            Every AI coding session on your machine, on one office floor. Local, private, MIT.
          </p>
          <p><code>npx deckhq app</code></p>
        </div>
        <div class="foot-col">
          <h2>Product</h2>
          <ul>
            <li><a href="${esc(up)}features.html">Features</a></li>
            <li><a href="${esc(up)}look.html">The look</a></li>
            <li><a href="${esc(up)}characters.html">Characters</a></li>
            <li><a href="${esc(up)}studio.html">Studio</a></li>
            <li><a href="${esc(up)}install.html">Install</a></li>
          </ul>
        </div>
        <div class="foot-col">
          <h2>Documentation</h2>
          <ul>
            <li><a href="${esc(up)}docs.html">All documents</a></li>
            <li><a href="${esc(up)}model.html">The model in 60 seconds</a></li>
            <li><a href="${esc(up)}hooks-and-privacy.html">Hooks and privacy</a></li>
            <li><a href="${esc(up)}adapters.html">Adapters</a></li>
            <li><a href="${esc(up)}faq.html">FAQ</a></li>
            <li><a href="${esc(up)}log/index.html">Engineering log</a></li>
          </ul>
        </div>
        <div class="foot-col">
          <h2>Project</h2>
          <ul>
            <li><a href="${REPO}">Source</a></li>
            <li><a href="https://www.npmjs.com/package/deckhq">npm</a></li>
            <li><a href="${REPO}/blob/main/CONTRIBUTING.md">Contributing</a></li>
            <li><a href="${REPO}/blob/main/SECURITY.md">Security</a></li>
            <li><a href="${REPO}/blob/main/CHANGELOG.md">Changelog</a></li>
            <li><a href="${REPO}/blob/main/LICENSE">Licence</a></li>
          </ul>
        </div>
      </div>
      <p class="foot-note">
        This site loads nothing from anywhere else. No web font, no CDN, no analytics, no
        third-party frame — and the product it documents makes no outbound network call of any
        kind.
      </p>
    </footer>
  </body>
</html>
`;
}

/* -------------------------------------------------------------- markdown */

/**
 * Inline markdown: code spans, links, images, strong, emphasis. Everything is
 * escaped first, so nothing below can introduce markup that was not written
 * here — the only tags in the output are the ones these five rules add.
 *
 * @param {string} text
 * @param {(src: string) => string} [rewriteSrc]
 * @param {(href: string) => string} [rewriteHref]
 */
function inline(text, rewriteSrc = (s) => s, rewriteHref = (s) => s) {
  // Code spans come out first and go back in last, so a `*` or a `[` inside
  // one is never read as emphasis or a link.
  /** @type {string[]} */
  const spans = [];
  let out = text.replace(/`([^`]+)`/g, (_m, code) => {
    spans.push(code);
    return `\u0000${spans.length - 1}\u0000`;
  });

  out = esc(out);

  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, src) => {
    const safe = safeUrl(src);
    return safe ? `<img src="${rewriteSrc(safe)}" alt="${alt}" loading="lazy" />` : m;
  });

  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, href) => {
    const safe = safeUrl(href);
    return safe ? `<a href="${rewriteHref(safe)}">${label}</a>` : m;
  });

  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[\s(—-])\*([^*\n]+)\*(?=$|[\s).,;:!?—])/g, '$1<em>$2</em>');
  out = out.replace(/(^|[\s(—])_([^_\n]+)_(?=$|[\s).,;:!?—])/g, '$1<em>$2</em>');

  return out.replace(/\u0000(\d+)\u0000/g, (_m, i) => `<code>${esc(spans[Number(i)])}</code>`);
}

/**
 * A URL is allowed into an `href` or a `src` only if it is relative, or `http`,
 * `https` or `mailto`. Anything else — `javascript:`, `data:`, a
 * protocol-relative `//host` — is left as the plain text it was written as.
 *
 * The input has already been through `esc()`, so this neither escapes nor
 * unescapes; it only decides.
 *
 * @param {string} raw
 * @returns {string | null}
 */
function safeUrl(raw) {
  const url = raw.trim();
  if (url.startsWith('//')) return null;
  if (/^(https?:|mailto:)/i.test(url)) return url;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return null;
  return url;
}

/**
 * Markdown down to the words in it, for a `<title>` and a `<meta>` — neither of
 * which renders a backtick or a pair of asterisks as anything but itself.
 *
 * @param {string} md
 */
function plain(md) {
  return md
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)\s]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|\s)[*_]([^*_\n]+)[*_](?=$|[\s).,;:!?])/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Split a table row on unescaped pipes. @param {string} line */
function cells(line) {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'));
}

/**
 * Markdown to HTML. Blocks: headings, fenced code, tables, lists, block
 * quotes, horizontal rules, paragraphs.
 *
 * @param {string} md
 * @param {{ headingOffset?: number, rewriteSrc?: (src: string) => string,
 *   rewriteHref?: (href: string) => string }} [options]
 */
function markdown(md, options = {}) {
  const offset = options.headingOffset ?? 0;
  const rewriteSrc = options.rewriteSrc ?? ((s) => s);
  const rewriteHref = options.rewriteHref ?? ((s) => s);
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  /** @type {string[]} */
  const out = [];
  let i = 0;

  const isBlockStart = (line) =>
    line.trim() === '' ||
    /^```/.test(line) ||
    /^#{1,6} /.test(line) ||
    /^\s*([-*+]|\d+\.)\s+/.test(line) ||
    /^>\s?/.test(line) ||
    /^\s*\|/.test(line) ||
    /^(-{3,}|\*{3,}|_{3,})\s*$/.test(line);

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i++;
      continue;
    }

    // Fenced code.
    const fence = line.match(/^```([a-zA-Z0-9-]*)\s*$/);
    if (fence) {
      const lang = fence[1];
      const body = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++; // the closing fence, or the end of the document
      const cls = lang ? ` class="lang-${esc(lang)}"` : '';
      out.push(`<pre><code${cls}>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }

    // Headings.
    const heading = line.match(/^(#{1,6}) (.*)$/);
    if (heading) {
      const level = Math.max(2, Math.min(6, heading[1].length + offset));
      out.push(`<h${level}>${inline(heading[2].trim(), rewriteSrc, rewriteHref)}</h${level}>`);
      i++;
      continue;
    }

    // Horizontal rule.
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push('<hr />');
      i++;
      continue;
    }

    // Table: a pipe row followed by a delimiter row.
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
      const th = head.map((c) => `<th>${inline(c, rewriteSrc, rewriteHref)}</th>`).join('');
      const body = rows
        .map(
          (r) =>
            `<tr>${r.map((c) => `<td>${inline(c, rewriteSrc, rewriteHref)}</td>`).join('')}</tr>`,
        )
        .join('\n');
      out.push(
        `<div class="table-scroll"><table>\n<thead><tr>${th}</tr></thead>\n<tbody>\n${body}\n</tbody>\n</table></div>`,
      );
      continue;
    }

    // Block quote.
    if (/^>\s?/.test(line)) {
      const body = [];
      while (i < lines.length && /^>/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>\n${markdown(body.join('\n'), options)}\n</blockquote>`);
      continue;
    }

    // Lists, nested by indentation. A blank line inside one is kept only when
    // the list carries on after it, so a loose list stays a single list.
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const isItem = (l) => /^\s*([-*+]|\d+\.)\s+/.test(l);
      const isCont = (l) => /^\s+\S/.test(l);
      const block = [];
      while (i < lines.length) {
        const blank = lines[i].trim() === '';
        if (isItem(lines[i]) || isCont(lines[i])) {
          block.push(lines[i++]);
        } else if (
          blank &&
          i + 1 < lines.length &&
          (isItem(lines[i + 1]) || isCont(lines[i + 1]))
        ) {
          block.push(lines[i++]);
        } else if (
          // Lazy continuation: an item's own text wrapped back to column 0,
          // which markdown allows and this log does. It only counts directly
          // under a line that was itself part of the list.
          !blank &&
          !isBlockStart(lines[i]) &&
          block.length &&
          block[block.length - 1].trim() !== ''
        ) {
          block.push(lines[i++]);
        } else {
          break;
        }
      }
      out.push(list(block, options));
      continue;
    }

    // Paragraph: soft-wrapped until a blank line or the next block.
    const para = [line];
    i++;
    while (i < lines.length && !isBlockStart(lines[i])) para.push(lines[i++]);
    out.push(`<p>${inline(para.join(' ').trim(), rewriteSrc, rewriteHref)}</p>`);
  }

  return out.join('\n');
}

/**
 * One list block, which may nest. Items are grouped by their indentation; a
 * deeper run becomes a list inside the item above it.
 *
 * @param {string[]} block
 * @param {{ headingOffset?: number, rewriteSrc?: (src: string) => string,
 *   rewriteHref?: (href: string) => string }} options
 */
function list(block, options) {
  const first = block[0].match(/^(\s*)([-*+]|\d+\.)\s+/);
  const indent = first[1].length;
  const ordered = /\d/.test(first[2]);
  /** @type {{ text: string[], children: string[] }[]} */
  const items = [];

  for (const raw of block) {
    if (raw.trim() === '') continue;
    const m = raw.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
    if (m && m[1].length <= indent) {
      items.push({ text: [m[3]], children: [] });
    } else if (items.length) {
      const item = items[items.length - 1];
      // A deeper bullet starts (or continues) a nested list; anything else is
      // a continuation line of the item's own paragraph.
      if (item.children.length || /^\s*([-*+]|\d+\.)\s+/.test(raw)) {
        item.children.push(raw.slice(Math.min(raw.length - raw.trimStart().length, indent + 2)));
      } else {
        item.text.push(raw.trim());
      }
    }
  }

  const rendered = items
    .map((item) => {
      const head = inline(
        item.text.join(' ').trim(),
        options.rewriteSrc ?? ((s) => s),
        options.rewriteHref ?? ((s) => s),
      );
      const nested = item.children.length ? `\n${markdown(item.children.join('\n'), options)}` : '';
      return `<li>${head}${nested}</li>`;
    })
    .join('\n');

  const tag = ordered ? 'ol' : 'ul';
  return `<${tag}>\n${rendered}\n</${tag}>`;
}

/* -------------------------------------------------- the engineering log */

/**
 * Split `docs/DEVIATIONS.md` into its `##` entries, respecting code fences so
 * a `## ` inside one is not read as a heading. Entry numbers repeat in the
 * file (two 48s, two 49s), so the file name is the entry's position, which is
 * stable in an append-only log; the number it carries is displayed as written.
 *
 * @param {string} md
 */
function splitEntries(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  /** @type {{ heading: string, number: string | null, body: string[] }[]} */
  const entries = [];
  const preamble = [];
  let fenced = false;
  let current = null;

  for (const line of lines) {
    if (/^```/.test(line)) fenced = !fenced;
    const heading = !fenced && line.match(/^## (.*)$/);
    if (heading) {
      current = { heading: heading[1].trim(), number: null, body: [] };
      const numbered = current.heading.match(/^(\d+(?:\.\d+)?)\.\s+(.*)$/);
      if (numbered) {
        current.number = numbered[1];
        current.heading = numbered[2];
      }
      entries.push(current);
      continue;
    }
    if (current) current.body.push(line);
    else preamble.push(line);
  }

  return { preamble: preamble.join('\n'), entries };
}

/* ------------------------------------------------------------------ build */

/** @param {string} p */
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function build() {
  // The registry's declared class has to be the one the source directory
  // implies, so the table above is readable on its own and cannot drift from
  // the rule `imageClass()` actually applies.
  for (const image of IMAGES) {
    const actual = imageClass(image.to);
    if (actual !== image.class) {
      throw new Error(`${image.from} is declared ${image.class} and is ${actual}`);
    }
  }

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'log'), { recursive: true });
  fs.mkdirSync(path.join(OUT, 'media'), { recursive: true });

  let written = 0;
  /** @param {string} rel @param {string} content */
  const write = (rel, content) => {
    fs.writeFileSync(path.join(OUT, rel), content);
    written++;
  };

  const deviations = read('docs/DEVIATIONS.md');
  const { preamble, entries } = splitEntries(deviations);
  // `docs/DEVIATIONS.md` links to its neighbours the way a file on disk does.
  // None of those files is published here, so a relative link becomes a link
  // into the repository at the path it meant; an image becomes the copy under
  // `dist/media/`; an anchor and an absolute URL are left alone.
  const rewriteSrc = (src) => (src.startsWith('media/') ? `../${src}` : src);
  const rewriteHref = (href) => {
    if (/^(https?:|mailto:|#)/i.test(href)) return href;
    const clean = href.replace(/^\.\//, '');
    return `${REPO}/blob/main/docs/${clean}`;
  };

  // The log's own images, on top of the registry above. A log entry's picture
  // is a capture by construction: it is what the package it records was
  // photographed doing, and it is kept at the path the markdown names.
  /** @type {Map<string, {from: string, class: string}>} */
  const media = new Map(IMAGES.map((image) => [image.to, image]));
  for (const m of deviations.matchAll(/!\[[^\]]*\]\((media\/[^)\s]+)\)/g)) {
    const rel = m[1].slice('media/'.length);
    if (!media.has(rel)) media.set(rel, { to: rel, from: `docs/media/${rel}`, class: 'capture' });
  }

  // The images go first, because the pages are measured against them: WP-94c's
  // `addImageDimensions()` reads the size out of the copy the site serves.
  let bytes = 0;
  let downscaled = 0;
  for (const [rel, image] of media) {
    const from = path.join(root, image.from);
    if (!fs.existsSync(from)) throw new Error(`${image.from} is referenced but missing`);
    const to = path.join(OUT, 'media', rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    // A picture the log carries declares no role — it is registered by the
    // markdown that shows it — and the log shows its images full width, so it
    // is held to the hero's width and the hero's budget.
    const role = ROLES[image.role ?? (rel.endsWith('.gif') ? 'gif' : 'hero')];
    const result = copyImage(from, to, role.width);
    if (result.bytes > role.budget) {
      throw new Error(
        `media/${rel} is ${Math.round(result.bytes / 1024)} KB, over the ` +
          `${Math.round(role.budget / 1024)} KB budget for a ${image.role ?? 'crop'}`,
      );
    }
    bytes += result.bytes;
    if (result.downscaled) downscaled++;
    written++;
  }

  // The hand-written pages. Each one is checked against the media policy
  // before it is written: a page that shows a mockup without saying so is a
  // build failure, not a review finding.
  for (const page of PAGES) {
    if (page.slug === 'log/index') continue;
    const source = read(path.join('site', 'pages', `${page.slug}.html`));
    assertMediaIsLabelled(`${page.slug}.html`, source);
    const body = addImageDimensions(source, OUT);
    write(`${page.slug}.html`, shell({ ...page, body, depth: 0 }));
  }

  const items = entries.map((entry, index) => ({
    ...entry,
    file: `${index + 1}.html`,
    label: entry.number ? `§${entry.number}` : '—',
  }));

  for (const [index, entry] of items.entries()) {
    const prev = items[index - 1];
    const next = items[index + 1];
    const nav = [
      prev ? `<a class="pager-prev" href="${prev.file}">← ${esc(prev.label)}</a>` : '<span></span>',
      next ? `<a class="pager-next" href="${next.file}">${esc(next.label)} →</a>` : '<span></span>',
    ].join('\n        ');

    const body = addImageDimensions(
      `      <article class="prose log-entry">
        <p class="log-back"><a href="index.html">Engineering log</a></p>
        <p class="log-number">${esc(entry.label)}</p>
        <h1>${inline(entry.heading, rewriteSrc, rewriteHref)}</h1>
${indentBlock(markdown(entry.body.join('\n'), { headingOffset: -1, rewriteSrc, rewriteHref }), 8)}
      </article>
      <nav class="pager" aria-label="Log entries">
        ${nav}
      </nav>`,
      OUT,
    );

    const words = plain(entry.heading);
    write(
      `log/${entry.file}`,
      shell({
        slug: `log/${entry.file.replace(/\.html$/, '')}`,
        title: `${entry.label} ${words}`.trim(),
        description: `DeckHQ engineering log ${entry.label}: ${words}`,
        body,
        depth: 1,
      }),
    );
  }

  const listing = items
    .map(
      (entry) =>
        `          <li><a href="${entry.file}"><span class="log-index-n">${esc(entry.label)}</span>` +
        `<span class="log-index-t">${inline(entry.heading, rewriteSrc, rewriteHref)}</span></a></li>`,
    )
    .join('\n');

  const indexBody = `      <article class="prose">
        <h1>Engineering log</h1>
        <p class="lede">
          Every place the build departed from its own blueprint, with the reason and the
          measurement. It is written as it goes, not afterwards, which is why it contains the
          budgets that were missed and the claims that did not survive being run on a machine.
        </p>
${indentBlock(markdown(preamble.replace(/^# .*$/m, '').trim(), { headingOffset: -1, rewriteSrc, rewriteHref }), 8)}
        <p class="muted">
          ${items.length} entries, oldest first. The source is
          <a href="${REPO}/blob/main/docs/DEVIATIONS.md"><code>docs/DEVIATIONS.md</code></a>;
          this is that file, rendered.
        </p>
        <ul class="log-index">
${listing}
        </ul>
      </article>`;

  write(
    'log/index.html',
    shell({
      slug: 'log/index',
      title: 'Engineering log',
      description:
        'Every place the DeckHQ build departed from its blueprint, with the reason and the ' +
        'measurement.',
      body: indexBody,
      depth: 1,
    }),
  );

  // Static assets. The two scripts are WP-94c and are listed here rather than
  // globbed, so a file dropped into `site/` is not published by accident.
  for (const asset of ['style.css', 'theme.js', 'site.js']) {
    fs.copyFileSync(path.join(here, asset), path.join(OUT, asset));
  }
  written += 2; // style.css is counted again below, with the two marks
  // WP-82 · the mark, copied and never redrawn: the SVG is the source in the
  // repository and the PNG is what scripts/brand/render-icons.mjs rendered from
  // it. The site has no third copy of either.
  fs.copyFileSync(
    path.join(root, 'public', 'brand', 'deckhq-mark.svg'),
    path.join(OUT, 'deckhq-mark.svg'),
  );
  fs.copyFileSync(path.join(root, 'public', 'icon-256.png'), path.join(OUT, 'deckhq-mark.png'));
  written += 3;

  // The one-line installers, byte for byte as they are in the repository, so
  // what a stranger pipes into their shell is a file that is reviewed, linted
  // and in the history rather than one this script generated.
  for (const installer of INSTALLERS) {
    const from = path.join(root, installer.from);
    if (!fs.existsSync(from)) throw new Error(`${installer.from} is missing`);
    fs.copyFileSync(from, path.join(OUT, installer.name));
    written++;
  }

  // GitHub Pages runs Jekyll over an upload unless told not to, and Jekyll
  // drops files and directories beginning with an underscore.
  write('.nojekyll', '');

  // WP-94b · what a page costs, page by page. The per-image budget above stops
  // one heavy picture; this stops twelve light ones. It runs last because a
  // page's weight includes the stylesheet and the scripts, which are copied
  // above, and it prints the number for every page so a build says where the
  // weight went rather than only that it was too much.
  const weights = PAGES.filter((p) => p.slug !== 'log/index').map((page) => ({
    page: `${page.slug}.html`,
    bytes: pageWeight(OUT, `${page.slug}.html`),
  }));
  for (const { page, bytes: weight } of weights) {
    const budget = PAGE_BUDGET[page] ?? PAGE_BUDGET.default;
    if (weight > budget) {
      throw new Error(
        `${page} weighs ${Math.round(weight / 1024)} KB, over its ` +
          `${Math.round(budget / 1024)} KB budget`,
      );
    }
  }
  const heaviest = weights.reduce((a, b) => (b.bytes > a.bytes ? b : a));

  process.stdout.write(
    `site: heaviest page ${heaviest.page} at ${(heaviest.bytes / 1024).toFixed(0)} KB\n` +
      `site: ${written} files -> ${path.relative(root, OUT) || OUT}` +
      ` (${PAGES.length - 1} pages, ${items.length} log entries, ${media.size} images` +
      ` at ${(bytes / 1024 / 1024).toFixed(1)} MB, ${downscaled} downscaled,` +
      ` ${INSTALLERS.length} installers)\n`,
  );
}

/* ------------------------------------------------------------------ media */

/**
 * One image into the site. A PNG wider than `MAX_IMAGE_WIDTH` is resampled to
 * it; everything else is copied byte for byte, so a golden on the site is the
 * golden in the tree and a GIF is never re-encoded.
 *
 * The resampler is a box filter over `scripts/lib/png.mjs`, which is the
 * goldens harness's own decoder — enough PNG for 8-bit non-interlaced images
 * and nothing else. An image it refuses (a palette PNG, 16-bit, interlaced) is
 * copied whole rather than dropped: a picture at the wrong size is a budget
 * problem, and a missing picture is a broken page.
 *
 * @param {string} from @param {string} to
 * @returns {{bytes: number, downscaled: boolean}}
 */
function copyImage(from, to, maxWidth = ROLES.hero.width) {
  const source = fs.readFileSync(from);
  if (path.extname(from).toLowerCase() === '.png') {
    try {
      const img = decodePng(source);
      if (img.width > maxWidth) {
        const small = boxDownscale(img, maxWidth);
        // `encodePng` writes one filter for every scanline, and which one wins
        // depends entirely on the picture — a flat floor likes `Up`, a shaded
        // sheet likes `Paeth`. There are three images in this repository wide
        // enough to reach here, so trying all five and keeping the smallest
        // costs a second and saves more than a guess would.
        let out = null;
        for (const filter of [0, 1, 2, 3, 4]) {
          const candidate = encodePng(small, { filter });
          if (!out || candidate.length < out.length) out = candidate;
        }
        // Written whether or not it is the smaller file. The budget being kept
        // is the WIDTH a reader downloads for a column 768 px wide, not the
        // byte count, and a picture at the right size is worth a few kilobytes
        // if it ever costs them. On the three images in this repository wide
        // enough to reach here it costs nothing: 1858 KB to 771 KB, 826 KB to
        // 774 KB, 591 KB to 355 KB.
        fs.writeFileSync(to, out);
        return { bytes: out.length, downscaled: true };
      }
    } catch {
      // Not a shape this decoder handles. Fall through to the plain copy.
    }
  }
  fs.writeFileSync(to, source);
  return { bytes: source.length, downscaled: false };
}

/**
 * Resample an RGBA image down to `width`, averaging each destination pixel
 * over the source box it covers. No sharpening and no gamma correction: these
 * are flat-shaded screenshots of a vector floor, and the only thing being
 * asked for is that a 2910 px capture stops being served at 2910 px to a
 * column 768 px wide.
 *
 * @param {{width: number, height: number, data: Uint8Array}} img
 * @param {number} width
 */
function boxDownscale(img, width) {
  const height = Math.max(1, Math.round((img.height * width) / img.width));
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy0 = Math.floor((y * img.height) / height);
    const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * img.height) / height));
    for (let x = 0; x < width; x++) {
      const sx0 = Math.floor((x * img.width) / width);
      const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * img.width) / width));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const i = (sy * img.width + sx) * 4;
          r += img.data[i];
          g += img.data[i + 1];
          b += img.data[i + 2];
          a += img.data[i + 3];
          n++;
        }
      }
      const o = (y * width + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }
  return { width, height, data: out };
}

/**
 * The class of one image, by the path a page writes in its `src` — WP-94a.
 * Anything sourced from one of `ILLUSTRATION_DIRS` is an illustration whatever
 * the registry claims, so a row added with the wrong class fails the build
 * rather than mislabelling a page.
 *
 * @param {string} src a `media/...` path as a page writes it
 * @returns {'capture'|'golden'|'illustration'|null}
 */
function imageClass(src) {
  const rel = src.replace(/^(?:\.\.\/)*media\//, '');
  const image = IMAGES.find((i) => i.to === rel);
  if (!image) return null;
  const dir = image.from.startsWith('docs/media/') ? image.from.split('/')[2] : null;
  if (dir && ILLUSTRATION_DIRS.includes(dir)) return 'illustration';
  return image.class;
}

/**
 * The honesty gate — WP-94a, and `docs/ADAPTERS.md` §6 applied to pictures.
 *
 * A mockup of a specification may be shown; it may not be shown as the
 * product. So every `<figure>` on a hand-written page that carries an
 * illustration must carry `design illustration` in its caption, and an
 * illustration outside a figure has nowhere to say what it is and is refused
 * outright.
 *
 * @param {string} name the page, for the message
 * @param {string} body the hand-written HTML body
 */
function assertMediaIsLabelled(name, body) {
  const seen = new Set();
  for (const m of body.matchAll(/<figure[\s>][\s\S]*?<\/figure>/g)) {
    const figure = m[0];
    const caption = (figure.match(/<figcaption[\s>]([\s\S]*?)<\/figcaption>/) ?? ['', ''])[1];
    for (const img of figure.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)) {
      seen.add(img[1]);
      if (imageClass(img[1]) !== 'illustration') continue;
      if (!caption.toLowerCase().includes(ILLUSTRATION_LABEL)) {
        throw new Error(
          `${name} shows ${img[1]}, which is a mockup, without "${ILLUSTRATION_LABEL}" in its caption`,
        );
      }
    }
  }
  for (const img of body.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)) {
    const src = img[1];
    if (seen.has(src) || !src.startsWith('media/')) continue;
    if (imageClass(src) === 'illustration') {
      throw new Error(`${name} shows ${src}, which is a mockup, outside a figure with a caption`);
    }
    if (imageClass(src) === null) {
      throw new Error(`${name} shows ${src}, which is not in the media registry`);
    }
  }
}

/**
 * What one page costs a reader who loads it whole — WP-94b.
 *
 * The document, the stylesheet, the two scripts, the mark, and every picture
 * the page shows, lazy ones included: a reader who scrolls to the bottom pays
 * for all of them, and the owner's report was about exactly that scroll.
 * Exported so the gate in `test/unit/site.test.mjs` measures the same bytes
 * this build refuses to publish.
 *
 * @param {string} outDir the built site
 * @param {string} rel a page, e.g. `features.html`
 * @returns {number} bytes
 */
function pageWeight(outDir, rel) {
  const file = path.join(outDir, rel);
  const html = fs.readFileSync(file, 'utf8');
  let bytes = Buffer.byteLength(html);
  for (const name of ['style.css', 'theme.js', 'site.js', 'deckhq-mark.png']) {
    const asset = path.join(outDir, name);
    if (fs.existsSync(asset)) bytes += fs.statSync(asset).size;
  }
  const seen = new Set();
  for (const tag of html.matchAll(/<img\b[^>]*>/g)) {
    const src = (tag[0].match(/\ssrc="([^"]+)"/) ?? ['', ''])[1];
    if (!src || seen.has(src)) continue;
    seen.add(src);
    const image = path.resolve(path.dirname(file), src);
    if (fs.existsSync(image)) bytes += fs.statSync(image).size;
  }
  return bytes;
}

/**
 * The pixel size of an image on disk — WP-94c.
 *
 * PNG through the goldens harness's own decoder; GIF out of its thirteen-byte
 * header, which carries the logical screen size in two little-endian shorts and
 * needs no decoder at all. Anything else, or anything malformed, is `null`.
 *
 * @param {string} file
 * @returns {{width: number, height: number} | null}
 */
function imageSize(file) {
  let bytes;
  try {
    bytes = fs.readFileSync(file);
  } catch {
    return null;
  }
  const ext = path.extname(file).toLowerCase();
  if (ext === '.png') {
    try {
      const { width, height } = decodePng(bytes);
      return { width, height };
    } catch {
      return null;
    }
  }
  if (ext === '.gif' && bytes.length > 10 && bytes.subarray(0, 3).toString('latin1') === 'GIF') {
    return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  }
  return null;
}

/**
 * Put the real `width` and `height` on every `media/` image that does not
 * already carry them — WP-94c.
 *
 * A picture without them is a picture the browser reserves no room for, so the
 * words under it move when it arrives. Doing it here rather than by hand means
 * the number is the file's own, cannot be typed wrong, and cannot be forgotten
 * on the next page somebody writes. A tag that already declares a size is left
 * exactly as it is: a hand-written pair is a deliberate one.
 *
 * @param {string} body the hand-written HTML body
 * @param {string} outDir where the images were copied to
 */
function addImageDimensions(body, outDir) {
  return body.replace(/<img\b[^>]*>/g, (tag) => {
    if (/\swidth="/.test(tag) || /\sheight="/.test(tag)) return tag;
    const src = (tag.match(/\ssrc="([^"]+)"/) ?? ['', ''])[1];
    // `media/...` on a hand-written page, `../media/...` in a rendered log
    // entry, which lives one directory down.
    const rel = src.replace(/^(?:\.\.\/)+/, '');
    if (!rel.startsWith('media/')) return tag;
    const size = imageSize(path.join(outDir, rel));
    if (!size) return tag;
    return tag.replace(/\s*\/?>$/, ` width="${size.width}" height="${size.height}" />`);
  });
}

/** @param {string} html @param {number} spaces */
function indentBlock(html, spaces) {
  const pad = ' '.repeat(spaces);
  return html
    .split('\n')
    .map((l) => (l ? pad + l : l))
    .join('\n');
}

/* ------------------------------------------------------------------ serve */

async function serve() {
  const { createServer } = await import('node:http');
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
  };
  createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(OUT, rel);
    if (!file.startsWith(OUT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found\n');
      return;
    }
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  }).listen(PORT, '127.0.0.1', () => {
    process.stdout.write(`site: http://127.0.0.1:${PORT}/\n`);
  });
}

// Running the file builds the site; importing it — which is what
// `test/unit/site.test.mjs` does to exercise the converter — does not.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  build();
  if (SERVE) await serve();
}

export {
  markdown,
  inline,
  plain,
  splitEntries,
  safeUrl,
  build,
  imageClass,
  imageSize,
  addImageDimensions,
  assertMediaIsLabelled,
  INSTALLERS,
  INSTALL_COMMANDS,
  IMAGES,
  ILLUSTRATION_DIRS,
  ILLUSTRATION_LABEL,
  ROLES,
  PAGE_BUDGET,
  pageWeight,
  PAGES,
  SITE_ORIGIN,
};
