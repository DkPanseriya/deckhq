/**
 * The public site, built with nothing.
 *
 *   node site/build.mjs                 # -> site/dist
 *   node site/build.mjs --out DIR       # anywhere else
 *   node site/build.mjs --serve         # build, then serve site/dist on 4600
 *
 * There is no site generator here and no dependency to add one. The pages in
 * `site/pages/` are hand-written HTML bodies; this script wraps each one in the
 * shared shell, finishes its pictures (`site/media.mjs`), renders the release
 * highlights out of `CHANGELOG.md` (`site/markdown.mjs`), once as a page and
 * once as an Atom feed, fills the blocks a page asks for by name
 * (`site/slots.mjs`), and copies the captures the pages show out of
 * `docs/media/site/`.
 *
 * The site is the product and what it does for the person using it. It
 * publishes no planning document and names none; `INTERNAL` below is that rule
 * as a pattern list, applied to every page this script writes and again, by
 * `test/unit/site.test.mjs`, to everything it built.
 *
 * The product makes no outbound network call, and its site keeps the same
 * promise: every stylesheet, script and image on it is served from the site's
 * own origin or is not there at all. No analytics, no CDN, no web font, no
 * third-party frame.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { esc, inline, markdown, plain, releaseHighlights, safeUrl } from './markdown.mjs';
import {
  assertComingIsLabelled,
  BUDGET,
  COMING,
  declaredMedia,
  dressImages,
  imageSize,
  MEDIA_DIR,
  media3d,
  NARROW,
  pageWeight,
  publishMedia,
  referencedMedia,
  resolveClips,
  resolveOptional,
} from './media.mjs';
import { placeholderTones } from './placeholder.mjs';
import {
  announceBar,
  atomFeed,
  FEED,
  fill,
  followBlock,
  followLinks,
  MAKER_URL,
  quotesBlock,
  releaseAnchor,
  waitlistButton,
  WAITLIST_URL,
} from './slots.mjs';

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
 * are. A GitHub project page, so the repository name is part of the path;
 * there is no custom domain and this file must not invent one.
 */
const SITE_ORIGIN = 'https://deckhq.dev';

/**
 * The one line DeckHQ is described by: in the home page's title, over its
 * headline, in every footer and on the card a link unfurls into. There is no
 * second one.
 */
const TAGLINE = 'An office for your AI coding agents';

/** The card a link to any page unfurls into: 1200 x 630. */
const PREVIEW = 'link-preview.png';

/**
 * The card of the one page that has a card of its own: the 3D page unfurls
 * into the floor today beside the same floor in 3D, which says Coming in the
 * picture. Its size is read from `site/3d-media.json`, not written here.
 */
const PREVIEW_3D = '3d/office@2x.png';

/** The stylesheet's sources, in the order they are joined into `style.css`. */
const STYLES = ['style.css', 'components.css', 'three-d.css'];

/* ------------------------------------------------------------------ pages */

/**
 * The site's pages. Each is a body fragment in `site/pages/` unless it says
 * `generated`; everything around it comes from `shell()`. A page with `nav` is
 * on the bar, in this order; the rest are reached from the footer.
 */
const PAGES = [
  {
    slug: 'index',
    title: `DeckHQ: ${TAGLINE[0].toLowerCase()}${TAGLINE.slice(1)}`,
    description:
      'The agent that finished an hour ago is still waiting for you. Every Claude Code ' +
      'and Codex session on one office floor until you clear it. Local, free, MIT.',
    loop: 'hero-walk',
  },
  {
    slug: 'features',
    nav: 'Features',
    title: 'Features',
    description:
      'Every session on one floor, the queue only you clear, crews and juniors, worktrees as ' +
      'benches, the session panel, Studio, and a picture you can post.',
  },
  {
    slug: 'look',
    nav: 'Look',
    title: 'Look',
    description:
      'Eleven styles, three lights, room colours, three themes and four agent sizes. The ' +
      'eleven styles are one floor, repainted.',
  },
  {
    slug: '3d',
    nav: '3D',
    // Not released: the bar says so beside the name, on every page.
    navTag: 'Coming',
    title: 'The same office, in 3D',
    description:
      'The DeckHQ office in 3D: every session a robot at a desk, the ones waiting on you on ' +
      'the sofa in your office. Coming. The office from above is free today.',
    card: {
      file: PREVIEW_3D,
      alt:
        'The same office twice: the DeckHQ floor seen from above, labelled Today, and beside ' +
        'it the same rooms in 3D, labelled Coming.',
    },
  },
  {
    slug: 'install',
    nav: 'Install',
    title: 'Install',
    description:
      'One command with Node 18 or newer, a one-line installer without it, or a step at a ' +
      'time. Then run it like an app.',
  },
  {
    slug: 'privacy',
    nav: 'Privacy',
    title: 'What it never does',
    description:
      'DeckHQ binds 127.0.0.1 and nothing else. No account, no telemetry, no update check. ' +
      'How to check each of those yourself.',
  },
  {
    slug: 'faq',
    nav: 'FAQ',
    title: 'Questions',
    description:
      'Which coding tools it reads, what it costs, what it writes to your disk, and what ' +
      'happens when you close the window.',
  },
  {
    slug: 'changelog',
    title: 'Changelog',
    generated: true,
    description: 'What each release of DeckHQ brought, in a paragraph each, newest first.',
  },
  {
    slug: '404',
    title: 'Nothing at this address',
    description:
      'There is no page at this address. The office is one link away, and so is the command.',
    // GitHub Pages serves this file for any missing path at any depth, so its
    // links are resolved from the site's own root rather than from the path
    // that was asked for.
    base: '/',
    unlisted: true,
  },
];

/**
 * Addresses this site used to have, which a README on npm, a release note or a
 * search result may still send a reader to. Each is a small page that forwards
 * to where its subject is now, with a plain link for a browser that does not
 * follow a refresh. None carries a word of the page it replaces, none is in
 * the sitemap, and each asks not to be indexed.
 *
 * `to` is an address on this site; `name` is what moved, for the title;
 * `moved` is the sentence the page says; `label` is the link.
 */
const REDIRECTS = [
  {
    slug: 'studio',
    to: 'features.html#studio',
    name: 'The Studio page',
    moved: 'Studio is a section of the Features page now.',
    label: 'Studio, on Features',
  },
  {
    slug: 'characters',
    to: 'features.html#see',
    name: 'The characters page',
    moved: 'The robots and their six states are on the Features page now.',
    label: 'The six states, on Features',
  },
  {
    slug: 'model',
    to: 'features.html#needs-you',
    name: 'The model page',
    moved: 'How the queue works is on the Features page now.',
    label: 'Know who needs you, on Features',
  },
  {
    slug: 'adapters',
    to: 'features.html#runtimes',
    name: 'The adapters page',
    moved: 'Which coding tools DeckHQ reads is a table on the Features page now.',
    label: 'Runtimes, on Features',
  },
  {
    slug: 'hooks-and-privacy',
    to: 'privacy.html',
    name: 'The hooks and privacy page',
    moved: 'Hooks and privacy are one page now, under the name What it never does.',
    label: 'What it never does',
  },
  {
    slug: 'docs',
    to: 'faq.html#manual',
    name: 'The documentation',
    moved: 'The documentation is the manual, and the manual is in the repository.',
    label: 'The way to the manual',
  },
  {
    // A page below the root, so its links resolve from the root, as the 404
    // page's do. `log/` is served this file too.
    slug: 'log/index',
    to: 'changelog.html',
    name: 'The engineering log',
    moved: 'The engineering log is no longer published. Each release is in the changelog.',
    label: 'The changelog',
    base: '/',
  },
];

for (const r of REDIRECTS) {
  PAGES.push({
    slug: r.slug,
    title: `${r.name} has moved`,
    description: `${r.moved} This address forwards there, and so does the link on it.`,
    redirect: r.to,
    generated: true,
    unlisted: true,
    ...(r.base ? { base: r.base } : {}),
  });
}

/**
 * What a public page may never say. These are the names the planning
 * documents go by; a page that carries one is either linking a private file or
 * narrating how the product is built, and both are off this site. The same
 * list is applied to `README.md` by `test/unit/readme.test.mjs`.
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
 * The one-line installers as the pages and the README print them. One source,
 * so the README test and the site test check the same three strings.
 */
const INSTALL_COMMANDS = [
  'npx deckhq app',
  'irm https://deckhq.dev/install.ps1 | iex',
  'curl -fsSL https://deckhq.dev/install.sh | sh',
];

/**
 * The installers, copied to the root of the site byte for byte. They are
 * served from here because this is the one URL that is stable, is under this
 * project's control, and deploys with every push to `main`. They are not in
 * the npm tarball and nothing in the product imports them.
 */
const INSTALLERS = [
  { name: 'install.ps1', from: path.join('scripts', 'install', 'install.ps1') },
  { name: 'install.sh', from: path.join('scripts', 'install', 'install.sh') },
];

/* ------------------------------------------------------------------ shell */

/** The address a page is published at. The home page is the directory itself. */
const pageUrl = (slug) => (slug === 'index' ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}/${slug}.html`);

/**
 * The `<head>`: a title and a description of the page's own, the card a link
 * to it unfurls into, and nothing fetched from anywhere else.
 *
 * @param {(typeof PAGES)[number]} page
 */
function head(page) {
  const full = page.slug === 'index' ? page.title : `${page.title} · DeckHQ`;
  // The card: the composed one, or a page's own, at the size its file has.
  const own = page.card ? media3d().get(page.card.file.split('/').pop()) : null;
  if (page.card && !own) throw new Error(`${page.slug}.html: its card is not in 3d-media.json`);
  const shown = own
    ? { file: page.card.file, width: own.width, height: own.height, alt: page.card.alt }
    : {
        file: PREVIEW,
        width: 1200,
        height: 630,
        alt: 'The DeckHQ floor: an office seen from above, with a robot at each desk and two waiting in Your Office.',
      };
  const card = `${SITE_ORIGIN}/media/${shown.file}`;
  // The first picture is asked for before the stylesheet has been read: the
  // whole window on a wide screen, its closer crop on a narrow one, and of
  // each the file for the density the screen has. One of the four is fetched.
  const hint = (name, media) =>
    `\n    <link rel="preload" as="image" href="media/${name}.png" imagesrcset="media/${name}.png 1x, media/${name}@2x.png 2x" media="${media}" fetchpriority="high" />`;
  // A page that opens on a loop asks for the loop's first frame, at the
  // density the screen has: it is what the page lays out and what is seen
  // until the video has a frame of its own, and all there is under reduced
  // motion. The video is not hinted; the element asks for it.
  const moving = (name) =>
    `\n    <link rel="preload" as="image" href="media/${name}.png" imagesrcset="media/${name}.png 1x, media/${name}@2x.png 2x" fetchpriority="high" />`;
  const preload = page.loop
    ? moving(page.loop)
    : page.preload
      ? hint(page.preload, '(min-width: 40rem)') + hint(`${page.preload}-phone`, NARROW)
      : '';
  const base = page.base ? `\n    <base href="${esc(page.base)}" />` : '';
  // No `<link rel="canonical">` on a page of its own: its address is in
  // `og:url`, and the rule that no `<link>` on this site names an absolute URL
  // has no exception. A page that only forwards names where it forwards to,
  // as a path on this site, which keeps that rule.
  const index = page.unlisted ? '\n    <meta name="robots" content="noindex" />' : '';
  const forward = page.redirect
    ? `\n    <meta http-equiv="refresh" content="0; url=${esc(page.redirect)}" />` +
      `\n    <link rel="canonical" href="${esc(page.redirect.split('#')[0])}" />`
    : '';
  return `<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />${base}
    <title>${esc(full)}</title>
    <meta name="description" content="${esc(page.description)}" />${index}${forward}
    <meta name="color-scheme" content="dark" />
    <meta name="theme-color" content="#131419" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="DeckHQ" />
    <meta property="og:title" content="${esc(full)}" />
    <meta property="og:description" content="${esc(page.description)}" />
    <meta property="og:url" content="${esc(pageUrl(page.slug))}" />
    <meta property="og:image" content="${esc(card)}" />
    <meta property="og:image:width" content="${shown.width}" />
    <meta property="og:image:height" content="${shown.height}" />
    <meta property="og:image:alt" content="${esc(shown.alt)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(full)}" />
    <meta name="twitter:description" content="${esc(page.description)}" />
    <meta name="twitter:image" content="${esc(card)}" />
    <link rel="stylesheet" href="style.css" />
    <link rel="icon" href="deckhq-mark.svg" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="deckhq-mark.png" />
    <link rel="alternate" type="application/atom+xml" title="DeckHQ releases" href="${FEED}" />${preload}
    <script src="site.js" defer></script>
  </head>`;
}

/**
 * @param {(typeof PAGES)[number] & { body: string }} page
 */
function shell(page) {
  const link = (p, indent) => {
    const current = p.slug === page.slug ? ' aria-current="page"' : '';
    // A page about something not released carries the tag beside its name.
    const tag = p.navTag ? ` <span class="tag tag--coming">${esc(p.navTag)}</span>` : '';
    return `${indent}<a href="${p.slug}.html"${current}>${esc(p.nav)}${tag}</a>`;
  };
  const bar = PAGES.filter((p) => p.nav);
  const nav = bar.map((p) => link(p, '          ')).join('\n');
  const drawer = bar.map((p) => link(p, '            ')).join('\n');
  const follow = followLinks({ repo: REPO, url: WAITLIST_URL })
    .map((li) => `            ${li}`)
    .join('\n');

  return `<!doctype html>
<html lang="en">
  ${head(page)}
  <body>
    <a class="skip-link" href="#main">Skip to content</a>
    ${page.slug === 'index' ? '' : announceBar()}
    <header class="site-head">
      <div class="wrap head-inner">
        <a class="brand" href="index.html">
          <img class="brand-mark" src="deckhq-mark.svg" alt="" width="26" height="26" />
          <span class="brand-name">DeckHQ</span>
        </a>
        <nav class="site-nav" aria-label="Sections">
${nav}
        </nav>
        <a class="head-out" href="${REPO}">GitHub</a>
        <details class="nav-toggle">
          <summary>Menu</summary>
          <nav class="nav-drawer" aria-label="Sections">
${drawer}
            <a href="${REPO}">GitHub</a>
          </nav>
        </details>
      </div>
    </header>

    <main id="main">
${page.body.replace(/\n$/, '')}
    </main>

    <footer class="site-foot">
      <div class="wrap foot-inner">
        <div class="foot-brand">
          <p class="foot-name">
            <img src="deckhq-mark.svg" alt="" width="22" height="22" />
            DeckHQ
          </p>
          <p>${TAGLINE}.</p>
          <p><code>npx deckhq app</code></p>
        </div>
        <div class="foot-col">
          <h2>Product</h2>
          <ul>
            <li><a href="features.html">Features</a></li>
            <li><a href="look.html">Look</a></li>
            <li><a href="3d.html">3D, coming</a></li>
            <li><a href="install.html">Install</a></li>
            <li><a href="changelog.html">Changelog</a></li>
          </ul>
        </div>
        <div class="foot-col">
          <h2>Trust</h2>
          <ul>
            <li><a href="privacy.html">What it never does</a></li>
            <li><a href="faq.html">Questions</a></li>
            <li><a href="${REPO}/blob/main/SECURITY.md">Security policy</a></li>
            <li><a href="${REPO}/blob/main/LICENSE">MIT licence</a></li>
          </ul>
        </div>
        <div class="foot-col">
          <h2>Project</h2>
          <ul>
            <li><a href="${REPO}">GitHub</a></li>
            <li><a href="https://www.npmjs.com/package/deckhq">npm</a></li>
            <li><a href="${REPO}/blob/main/docs/GUIDE.md">The manual</a></li>
            <li><a href="${REPO}/issues">Report a problem</a></li>
          </ul>
        </div>
        <div class="foot-col">
          <h2>Follow</h2>
          <ul>
${follow}
          </ul>
        </div>
      </div>
      <p class="wrap foot-note">
        Built by Darshak Panseriya. <a href="${MAKER_URL}">More by Darshak</a>. This site loads
        nothing from anywhere else: no web font, no CDN, no analytics.
      </p>
    </footer>
  </body>
</html>
`;
}

/* ------------------------------------------------------------------ build */

/** @param {string} p */
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

/** @param {string} html @param {number} spaces */
function indentBlock(html, spaces) {
  const pad = ' '.repeat(spaces);
  return html
    .split('\n')
    .map((l) => (l ? pad + l : l))
    .join('\n');
}

/**
 * The changelog page: the paragraph each release opens with. A reader who
 * wants every bullet has the file on GitHub, which is where the last line of
 * the page sends them.
 *
 * @param {{ version: string, date: string, highlights: string }[]} releases
 */
function changelogBody(releases) {
  const sections = releases
    .map(
      (release) => `          <section class="release" id="${releaseAnchor(release.version)}">
            <h2>${esc(release.version)}${release.date ? ` <span class="release-date">${esc(release.date)}</span>` : ''}</h2>
${indentBlock(markdown(release.highlights), 12)}
          </section>`,
    )
    .join('\n');
  return `      <div class="page-head wrap">
        <h1>Changelog.</h1>
        <p class="lede">What each release brought, in a paragraph.</p>
      </div>
      <div class="wrap">
        <div class="releases prose">
${sections}
          <p class="quiet">
            Every change, release by release, is in
            <a href="${REPO}/blob/main/CHANGELOG.md">the full changelog</a> on GitHub.
          </p>
        </div>
      </div>`;
}

/**
 * A page that forwards: one sentence saying where its subject went, and a
 * link there for a browser that does not follow the refresh in its `<head>`.
 *
 * @param {(typeof REDIRECTS)[number]} r
 */
function redirectBody(r) {
  return `      <div class="page-head wrap">
        <h1>This page has moved.</h1>
        <p class="lede">${esc(r.moved)}</p>
        <p class="actions">
          <a class="btn" href="${esc(r.to)}">${esc(r.label)}</a>
          <a class="btn btn--ghost" href="index.html">Back to the floor</a>
        </p>
      </div>`;
}

function build() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  let written = 0;
  /** @param {string} rel @param {string} content */
  const write = (rel, content) => {
    fs.mkdirSync(path.dirname(path.join(OUT, rel)), { recursive: true });
    fs.writeFileSync(path.join(OUT, rel), content);
    written++;
  };

  const releases = releaseHighlights(read('CHANGELOG.md'));

  // The blocks a page asks for by name. What users said is a data file, and
  // an empty one renders nothing.
  const slots = {
    follow: followBlock({ repo: REPO, url: WAITLIST_URL }),
    quotes: quotesBlock(JSON.parse(read(path.join('site', 'quotes.json'))).quotes),
    // The e-mail button, where a page about 3D asks for it: quiet beside
    // another button, large on the 3D page. Nothing while there is no form.
    waitlist: waitlistButton({ label: 'Tell me when it is ready', kind: 'btn--ghost' }),
    'waitlist-large': waitlistButton({ label: 'Tell me when it is ready', kind: 'btn--large' }),
  };

  // The bodies first, because the pictures are published from what the pages
  // actually show: a capture no page uses is not on the site.
  const bodies = PAGES.map((page) => {
    const moved = REDIRECTS.find((r) => r.slug === page.slug);
    const source = moved
      ? redirectBody(moved)
      : page.generated
        ? changelogBody(releases)
        : read(path.join('site', 'pages', `${page.slug}.html`));
    return { page, body: fill(resolveClips(resolveOptional(source)), slots) };
  });
  const shown = new Set([PREVIEW, ...PAGES.filter((p) => p.card).map((p) => p.card.file)]);
  for (const { page, body } of bodies) {
    assertComingIsLabelled(`${page.slug}.html`, body);
    for (const file of referencedMedia(body)) shown.add(file);
  }
  const media = publishMedia(OUT, [...shown]);
  written += media.count;

  const tones = placeholderTones(read(path.join('site', STYLES[0])));
  for (const { page, body } of bodies) {
    const html = shell({ ...page, body: dressImages(body, OUT, tones) });
    assertNothingInternal(`${page.slug}.html`, html);
    write(`${page.slug}.html`, html);
  }

  // Static assets, listed rather than globbed, so a file dropped into `site/`
  // is not published by accident. The mark is copied and never redrawn.
  // The stylesheet is written in two files so neither is long, and served as
  // one so a page makes one request for it.
  write('style.css', STYLES.map((name) => read(path.join('site', name))).join('\n'));
  fs.copyFileSync(path.join(here, 'site.js'), path.join(OUT, 'site.js'));
  fs.copyFileSync(
    path.join(root, 'public', 'brand', 'deckhq-mark.svg'),
    path.join(OUT, 'deckhq-mark.svg'),
  );
  fs.copyFileSync(path.join(root, 'public', 'icon-256.png'), path.join(OUT, 'deckhq-mark.png'));
  written += 3;

  // The installers, byte for byte as they are in the repository, so what a
  // stranger pipes into a shell is a file that is reviewed and in the history.
  for (const installer of INSTALLERS) {
    const from = path.join(root, installer.from);
    if (!fs.existsSync(from)) throw new Error(`${installer.from} is missing`);
    fs.copyFileSync(from, path.join(OUT, installer.name));
    written++;
  }

  // A plain-text sitemap: one address a line, which needs no namespace and so
  // names no host but this one.
  const listed = PAGES.filter((p) => !p.unlisted).map((p) => pageUrl(p.slug));
  write('sitemap.txt', `${listed.join('\n')}\n`);
  write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${SITE_ORIGIN}/sitemap.txt\n`);

  // The releases as a feed, for a reader who would rather be told than look.
  write(FEED, atomFeed({ origin: SITE_ORIGIN, releases, render: markdown }));

  // GitHub Pages runs Jekyll over an upload unless told not to.
  write('.nojekyll', '');

  // What each page costs, on a dense screen, read to the bottom. The per-file
  // budget stops one heavy picture; this stops twelve light ones.
  const weights = PAGES.map((page) => ({
    page: `${page.slug}.html`,
    bytes: pageWeight(OUT, `${page.slug}.html`),
  }));
  for (const { page, bytes } of weights) {
    const budget = BUDGET.page[page] ?? BUDGET.page.default;
    if (bytes > budget) {
      throw new Error(
        `${page} weighs ${Math.round(bytes / 1024)} KB, over its ` +
          `${Math.round(budget / 1024)} KB budget`,
      );
    }
  }
  const first = pageWeight(OUT, 'index.html', { all: false });
  if (first > BUDGET.firstView) {
    throw new Error(`the home page's first view is ${Math.round(first / 1024)} KB`);
  }
  // A screen under 40rem is offered the walk at half the width.
  const phone = pageWeight(OUT, 'index.html', { all: false, narrow: true });
  const kb = (n) => `${Math.round(n / 1024)} KB`;
  // The 3D page before a reader scrolls: held to its budget without the clip
  // its first picture may play, and that clip is said beside it.
  const first3d = pageWeight(OUT, '3d.html', { all: false, videos: false });
  if (first3d > BUDGET.firstView3d) {
    throw new Error(`the 3D page's first view is ${kb(first3d)}, over ${kb(BUDGET.firstView3d)}`);
  }
  const clip3d = pageWeight(OUT, '3d.html', { all: false }) - first3d;
  const heaviest = weights.reduce((a, b) => (b.bytes > a.bytes ? b : a));
  const home = weights.find((w) => w.page === 'index.html');

  process.stdout.write(
    `site: home ${kb(first)} before scrolling (${kb(phone)} on a phone), ` +
      `${kb(home.bytes)} read to the bottom\n` +
      `site: 3d ${kb(first3d)} before scrolling` +
      (clip3d ? `, and ${kb(clip3d)} of clip over its first picture\n` : ', no clip yet\n') +
      `site: heaviest page ${heaviest.page} at ${kb(heaviest.bytes)}; ` +
      `heaviest picture ${media.heaviest.file} at ${kb(media.heaviest.bytes)}\n` +
      `site: ${written} files -> ${path.relative(root, OUT) || OUT}` +
      ` (${PAGES.length - REDIRECTS.length} pages, ${REDIRECTS.length} forwarding addresses,` +
      ` ${releases.length} releases, ${media.count} pictures` +
      ` at ${(media.bytes / 1024 / 1024).toFixed(1)} MB, ${INSTALLERS.length} installers)\n`,
  );
}

/* ------------------------------------------------------------------ serve */

async function serve() {
  const { createServer } = await import('node:http');
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.xml': 'application/atom+xml; charset=utf-8',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.mp4': 'video/mp4',
    '.svg': 'image/svg+xml',
  };
  createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    // Served at the root, where the site is published (its own domain), so
    // the 404 page's `<base>` resolves here exactly as it does there.
    let rel = decodeURIComponent(url.pathname).replace(/^\//, '');
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    let file = path.resolve(OUT, rel);
    let status = 200;
    if (!file.startsWith(OUT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(OUT, '404.html');
      status = 404;
    }
    res.writeHead(status, {
      'content-type': types[path.extname(file)] ?? 'application/octet-stream',
    });
    res.end(fs.readFileSync(file));
  }).listen(PORT, '127.0.0.1', () => {
    process.stdout.write(`site: http://127.0.0.1:${PORT}/\n`);
  });
}

// Running the file builds the site; importing it, which is what
// `test/unit/site.test.mjs` does to exercise its rules, does not.
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
  imageSize,
  dressImages,
  resolveOptional,
  resolveClips,
  media3d,
  referencedMedia,
  declaredMedia,
  assertComingIsLabelled,
  assertNothingInternal,
  pageWeight,
  BUDGET,
  COMING,
  MEDIA_DIR,
  INTERNAL,
  INSTALLERS,
  INSTALL_COMMANDS,
  PAGES,
  REDIRECTS,
  PREVIEW,
  SITE_ORIGIN,
  STYLES,
  TAGLINE,
};
