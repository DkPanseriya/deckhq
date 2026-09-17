/**
 * The public site, built with nothing.
 *
 *   node site/build.mjs                 # -> site/dist
 *   node site/build.mjs --out /tmp/x    # anywhere else
 *   node site/build.mjs --serve         # build, then serve site/dist on 4600
 *
 * There is no site generator here and there is no dependency to add one. The
 * pages in `site/pages/` are hand-written HTML bodies; this script wraps each
 * one in the shared shell, renders the release highlights out of
 * `CHANGELOG.md`, and copies the images the pages reference out of
 * `docs/media/`.
 *
 * WP-95a · this site is the product, not the blueprint. The owner: *"The
 * website is purely public marketing and PR. Do not put requirements and
 * architecture docs there. We only put the product public and its features."*
 * So the pages show what DeckHQ does for the person using it, and nothing here
 * publishes, renders or links an internal document. `INTERNAL` below is that
 * rule as a pattern list, applied to every page this script writes, and
 * `test/unit/site.test.mjs` applies it again to the built site and to the
 * README.
 *
 * The product makes no outbound network calls of any kind, and its site keeps
 * the same promise: every stylesheet, script, image and font on it is either
 * served from the site's own origin or is not there at all. There is no
 * analytics, no CDN, no web font and no third-party frame.
 *
 * The markdown converter below is deliberately small: headings, paragraphs,
 * lists, tables, block quotes, rules, fenced code, and five inline forms.
 * Everything is escaped before anything is added, so a `<script>` in a release
 * note renders as the six visible characters it is.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { boxDownscale, decodePng, encodePng } from '../scripts/lib/png.mjs';

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
 * The site's pages, in navigation order. Each one is a body fragment in
 * `site/pages/` unless it says `generated`; everything around it comes from
 * `shell()`. A page with no `nav` is reachable from the footer and from the
 * pages that link it, and is not on the bar.
 */
const PAGES = [
  {
    slug: 'index',
    title: 'DeckHQ',
    description:
      'Every AI coding session on your machine, on one office floor. It sees the ones your ' +
      'terminal forgot, and it remembers what is waiting on you even after you have read it.',
  },
  {
    slug: 'features',
    nav: 'Features',
    title: 'Features',
    description:
      'The floor, the queue, the review card, permissions, token usage, pinning, app mode, ' +
      'notifications and themes — one picture each.',
  },
  {
    slug: 'look',
    nav: 'Look',
    title: 'The look',
    description: 'Three finishes, and the floor materials, colours and agent sizes you can set.',
  },
  {
    slug: 'characters',
    nav: 'Characters',
    title: 'The characters',
    description: 'The figure on the floor: a face, a name, a desk, and a walk you can read.',
  },
  {
    slug: 'studio',
    nav: 'Studio',
    title: 'Studio',
    description:
      'Come with an idea, leave with an office: the plan, the roster and the board that live ' +
      'in your own repository.',
  },
  {
    slug: 'install',
    nav: 'Install',
    title: 'Install',
    description: 'npx, a global install, the Claude Code plugin, the VS Code extension.',
  },
  {
    slug: 'faq',
    nav: 'FAQ',
    title: 'FAQ',
    description: 'Ten questions about what DeckHQ does, what it costs and what it never sends.',
  },
  {
    slug: 'privacy',
    title: 'Privacy and security',
    description:
      'What stays on your machine, what DeckHQ asks before it writes anything, and how to ' +
      'report a vulnerability.',
  },
  {
    slug: 'changelog',
    title: 'Changelog',
    generated: true,
    description: 'What each release of DeckHQ brought, in a paragraph.',
  },
];

/**
 * What a public page may never say — WP-95a.
 *
 * The owner keeps the blueprint private: *"Although it is public on GitHub, I
 * would not give the blueprint so anybody can build it."* These are the names
 * that blueprint goes by. A page that carries one of them is either linking an
 * internal document or narrating how the product is built, and both are off
 * this site. The same list is applied to `README.md` by
 * `test/unit/readme.test.mjs`.
 */
const INTERNAL = [
  /docs\/plan/i,
  /DEVIATIONS/,
  /00-REQUIREMENTS/,
  /02-ARCHITECTURE/,
  /ARCHITECTURE-AUDIT/,
  /STUDIO-DESIGN/,
  /RELAY-DESIGN/,
  /WP-\d/,
  /§\d/,
];

/**
 * Refuse a page that names the blueprint — WP-95a.
 *
 * @param {string} name the page, for the message
 * @param {string} html everything the reader receives
 */
function assertNothingInternal(name, html) {
  for (const pattern of INTERNAL) {
    const hit = pattern.exec(html);
    if (hit) {
      throw new Error(
        `${name} names ${hit[0]}, which belongs to the blueprint rather than to the product`,
      );
    }
  }
}

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
  { to: 'floor/three.png', from: 'test/goldens/win32/three.png', class: 'golden', role: 'hero' },
  { to: 'floor/demo.png', from: 'test/goldens/win32/demo.png', class: 'golden', role: 'crop' },
  {
    to: 'floor/single.png',
    from: 'test/goldens/win32/single.png',
    class: 'golden',
    role: 'hero',
  },
  {
    to: 'floor/demo-night-shift.png',
    from: 'test/goldens/win32/demo@night-shift.png',
    class: 'golden',
    role: 'crop',
  },
  {
    to: 'floor/demo-blueprint.png',
    from: 'test/goldens/win32/demo@blueprint.png',
    class: 'golden',
    role: 'crop',
  },

  // WP-94b · the pictures the pages actually show. Declared in
  // `site/assets.json`, taken from the running product by
  // `scripts/site-assets.mjs`, and registered in `docs/MEDIA.md` §4.5. Each
  // one is a crop of the thing its words are about rather than a photograph
  // of the whole window with the thing somewhere in it.
  {
    to: 'site/floor-crowded.gif',
    from: 'docs/media/site/floor-crowded.gif',
    class: 'capture',
    role: 'gif',
  },
  { to: 'site/typing.gif', from: 'docs/media/site/typing.gif', class: 'capture', role: 'gif' },
  { to: 'site/lounge.gif', from: 'docs/media/site/lounge.gif', class: 'capture', role: 'gif' },
  { to: 'site/hand-up.gif', from: 'docs/media/site/hand-up.gif', class: 'capture', role: 'gif' },
  {
    to: 'site/queue-strip.png',
    from: 'docs/media/site/queue-strip.png',
    class: 'capture',
    role: 'crop',
  },
  {
    to: 'site/room-plate.png',
    from: 'docs/media/site/room-plate.png',
    class: 'capture',
    role: 'crop',
  },
  {
    to: 'site/reception.png',
    from: 'docs/media/site/reception.png',
    class: 'capture',
    role: 'crop',
  },
  {
    to: 'site/lounge-bay.png',
    from: 'docs/media/site/lounge-bay.png',
    class: 'capture',
    role: 'crop',
  },
  {
    to: 'site/idle-popover.png',
    from: 'docs/media/site/idle-popover.png',
    class: 'capture',
    role: 'crop',
  },
  {
    to: 'site/deck-usage.png',
    from: 'docs/media/site/deck-usage.png',
    class: 'capture',
    role: 'crop',
  },
  {
    to: 'site/review-card.png',
    from: 'docs/media/site/review-card.png',
    class: 'capture',
    role: 'crop',
  },
  {
    to: 'site/permission-card.png',
    from: 'docs/media/site/permission-card.png',
    class: 'capture',
    role: 'crop',
  },
  {
    to: 'site/deck-queue.png',
    from: 'docs/media/site/deck-queue.png',
    class: 'capture',
    role: 'crop',
  },
  {
    to: 'site/room-plate-night-shift.png',
    from: 'docs/media/site/room-plate-night-shift.png',
    class: 'capture',
    role: 'crop',
  },
  {
    to: 'site/room-plate-blueprint.png',
    from: 'docs/media/site/room-plate-blueprint.png',
    class: 'capture',
    role: 'crop',
  },

  // The older captures — the app window, the cleared office, Wrapped, the deck,
  // the panel — are off this list since WP-94b. They are photographs of builds
  // before WP-79 and WP-87, they are still in `docs/media/` for the log entries
  // that cite them, and a log entry's own picture registers itself below.

  // No illustrations. A drawing of a specification could be published while the
  // thing it drew was still coming; the interior picker, agent size and the
  // crew all shipped in 1.4.0, so the drawings of them are off the site and
  // what a reader sees is the product. The label and the gate below stay: they
  // are what makes publishing a mockup a deliberate act rather than an
  // accident.
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
  // One flat bar of six — WP-95a. The reference pages that used to sit behind a
  // "More" disclosure are off the site, so six product links fit in a row and
  // the disclosure that hid half of them is gone. Under 45rem the row collapses
  // into a `<details>` menu, which is why the site navigates with scripting
  // switched off.
  const link = (p, indent) => {
    const href = p.slug === 'index' ? `${up}index.html` : `${up}${p.slug}.html`;
    const current = p.slug === here_;
    return `${indent}<a href="${esc(href)}"${current ? ' aria-current="page"' : ''}>${esc(p.nav)}</a>`;
  };
  const bar = PAGES.filter((p) => p.nav);

  const nav = bar.map((p) => link(p, '          ')).join('\n');
  const drawer = bar.map((p) => link(p, '            ')).join('\n');

  const full = page.slug === 'index' ? 'DeckHQ' : `${page.title} — DeckHQ`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(full)}</title>
    <meta name="description" content="${esc(page.description)}" />
    <meta name="color-scheme" content="dark light" />
    <link rel="stylesheet" href="${esc(up)}style.css" />
    <link rel="icon" href="${esc(up)}deckhq-mark.svg" type="image/svg+xml" />
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
          <h2>Help</h2>
          <ul>
            <li><a href="${esc(up)}faq.html">FAQ</a></li>
            <li><a href="${esc(up)}privacy.html">Privacy and security</a></li>
            <li><a href="${esc(up)}changelog.html">Changelog</a></li>
            <li><a href="${REPO}/issues">Report a problem</a></li>
          </ul>
        </div>
        <div class="foot-col">
          <h2>Project</h2>
          <ul>
            <li><a href="${REPO}">GitHub</a></li>
            <li><a href="https://www.npmjs.com/package/deckhq">npm</a></li>
            <li><a href="${REPO}/blob/main/LICENSE">Licence &#183; MIT</a></li>
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

/* ------------------------------------------------------------- changelog */

/**
 * The release highlights, out of `CHANGELOG.md` — WP-95a.
 *
 * A reader who wants to know what a release brought wants the paragraph, not
 * the four hundred bullets under it. So this reads only the `### Highlights`
 * prose of each `## <version> — <date>` section and nothing else: no bullet
 * lists, no `Added`, no `Fixed`, and therefore none of the package ids and
 * entry numbers those carry.
 *
 * A release written before the highlights paragraph existed is simply not
 * published here; the whole file is on GitHub, and the page says so.
 *
 * @param {string} md
 * @returns {{ version: string, date: string, highlights: string }[]}
 */
function releaseHighlights(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  /** @type {{ version: string, date: string, highlights: string }[]} */
  const releases = [];
  let fenced = false;
  let current = null;
  let inHighlights = false;

  for (const line of lines) {
    if (/^```/.test(line)) fenced = !fenced;
    if (fenced) {
      if (inHighlights) current.body.push(line);
      continue;
    }

    const release = line.match(/^## (\d+\.\d+\.\d+)(?:\s+[—-]\s+(.*))?$/);
    if (release) {
      current = { version: release[1], date: (release[2] ?? '').trim(), body: [] };
      releases.push(current);
      inHighlights = false;
      continue;
    }
    if (/^## /.test(line)) {
      current = null;
      inHighlights = false;
      continue;
    }
    const section = line.match(/^### (.*)$/);
    if (section) {
      inHighlights = current !== null && section[1].trim().toLowerCase() === 'highlights';
      continue;
    }
    // A bullet ends the paragraph: highlights are prose, and anything listed
    // under that heading belongs to the full file rather than to this page.
    if (inHighlights && /^\s*[-*+]\s/.test(line)) inHighlights = false;
    else if (inHighlights) current.body.push(line);
  }

  return releases
    .map((r) => ({ version: r.version, date: r.date, highlights: r.body.join('\n').trim() }))
    .filter((r) => r.highlights.length > 0);
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
  fs.mkdirSync(path.join(OUT, 'media'), { recursive: true });

  let written = 0;
  /** @param {string} rel @param {string} content */
  const write = (rel, content) => {
    fs.writeFileSync(path.join(OUT, rel), content);
    written++;
  };

  const releases = releaseHighlights(read('CHANGELOG.md'));

  // Every picture the site serves is one a page declares. The engineering log
  // is off this site, and so are the pictures that were published only because
  // a log entry cited them.
  /** @type {Map<string, {to: string, from: string, class: string, role?: string}>} */
  const media = new Map(IMAGES.map((image) => [image.to, image]));

  // The images go first, because the pages are measured against them: WP-94c's
  // `addImageDimensions()` reads the size out of the copy the site serves.
  let bytes = 0;
  let downscaled = 0;
  for (const [rel, image] of media) {
    const from = path.join(root, image.from);
    if (!fs.existsSync(from)) throw new Error(`${image.from} is referenced but missing`);
    const to = path.join(OUT, 'media', rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    const role = ROLES[image.role ?? (rel.endsWith('.gif') ? 'gif' : 'crop')];
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

  // The changelog, as the paragraph each release opens with — WP-95a. A reader
  // who wants the four hundred bullets has the file on GitHub, which is where
  // the last line of this page sends them.
  const changelogBody = `      <article class="prose">
        <h1>Changelog</h1>
        <p class="lede">
          What each release brought, in a paragraph. The date is the day that version went out.
        </p>
${releases
  .map(
    (release) => `        <section class="release">
          <h2>${esc(release.version)}${release.date ? ` <span class="release-date">${esc(release.date)}</span>` : ''}</h2>
${indentBlock(markdown(release.highlights), 10)}
        </section>`,
  )
  .join('\n')}
        <p class="muted">
          Every change, release by release, is in
          <a href="${REPO}/blob/main/CHANGELOG.md">the full changelog</a> on GitHub.
        </p>
      </article>`;

  // The pages. Each one is checked against the media policy before it is
  // written — a page that shows a mockup without saying so is a build failure,
  // not a review finding — and then against the blueprint rule, over the whole
  // document a reader receives rather than over the fragment.
  for (const page of PAGES) {
    const source = page.generated
      ? changelogBody
      : read(path.join('site', 'pages', `${page.slug}.html`));
    assertMediaIsLabelled(`${page.slug}.html`, source);
    const body = addImageDimensions(source, OUT);
    const html = shell({ ...page, body, depth: 0 });
    assertNothingInternal(`${page.slug}.html`, html);
    write(`${page.slug}.html`, html);
  }

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
  const weights = PAGES.map((page) => ({
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
      ` (${PAGES.length} pages, ${releases.length} releases, ${media.size} images` +
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
  releaseHighlights,
  safeUrl,
  build,
  imageClass,
  imageSize,
  addImageDimensions,
  assertMediaIsLabelled,
  assertNothingInternal,
  INTERNAL,
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
