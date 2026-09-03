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

/* ------------------------------------------------------------------ pages */

/**
 * The site's pages, in navigation order. `file` is a body fragment in
 * `site/pages/`; everything around it comes from `shell()`.
 */
const PAGES = [
  {
    slug: 'index',
    nav: 'Home',
    title: 'DeckHQ',
    description:
      'Every AI coding session on your machine, on one office floor. It sees the ones your ' +
      'terminal forgot, and it remembers what is waiting on you even after you have read it.',
  },
  {
    slug: 'model',
    nav: 'The model',
    title: 'The model in 60 seconds',
    description: 'The six states, and the one rule that decides what you owe.',
  },
  {
    slug: 'install',
    nav: 'Install',
    title: 'Install',
    description: 'npx, a global install, the Claude Code plugin, the VS Code extension.',
  },
  {
    slug: 'hooks-and-privacy',
    nav: 'Hooks and privacy',
    title: 'Hooks and privacy',
    description:
      'What DeckHQ reads, what it writes, what it asks you first, and where it sends it.',
  },
  {
    slug: 'adapters',
    nav: 'Adapters',
    title: 'Adapters',
    description: 'Which runtimes DeckHQ reads, how verified each one is, and how to add one.',
  },
  {
    slug: 'faq',
    nav: 'FAQ',
    title: 'FAQ',
    description: 'The questions this project is asked most, answered with what has been measured.',
  },
  { slug: 'log/index', nav: 'Engineering log', title: 'Engineering log', description: '' },
];

/** Images copied out of `docs/media/` into `dist/media/`. */
const MEDIA = ['hero.gif', 'floor.png', 'panel-review-card.png', 'deck-view.png'];

/* ------------------------------------------------------------------ shell */

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * @param {{ title: string, description: string, body: string, slug: string, depth?: number }} page
 */
function shell(page) {
  const up = '../'.repeat(page.depth ?? 0);
  const here_ = page.slug;
  const nav = PAGES.map((p) => {
    const href = p.slug === 'index' ? `${up}index.html` : `${up}${p.slug}.html`;
    const current = p.slug === here_ || (p.slug === 'log/index' && here_.startsWith('log/'));
    return `        <a href="${esc(href)}"${current ? ' aria-current="page"' : ''}>${esc(p.nav)}</a>`;
  }).join('\n');

  const full = page.slug === 'index' ? 'DeckHQ' : `${page.title} — DeckHQ`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(full)}</title>
    <meta name="description" content="${esc(page.description)}" />
    <meta name="color-scheme" content="dark" />
    <link rel="stylesheet" href="${esc(up)}style.css" />
    <link rel="icon" href="${esc(up)}favicon.svg" type="image/svg+xml" />
  </head>
  <body>
    <a class="skip-link" href="#main">Skip to content</a>
    <header class="site-head">
      <a class="brand" href="${esc(up)}index.html">
        <span class="brand-mark" aria-hidden="true"></span>
        <span class="brand-name">DeckHQ</span>
      </a>
      <nav class="site-nav" aria-label="Sections">
${nav}
      </nav>
    </header>

    <main id="main">
${page.body.replace(/\n$/, '')}
    </main>

    <footer class="site-foot">
      <p class="foot-pitch">
        <code>npx deckhq</code> · local · MIT · no telemetry, no network calls of any kind
      </p>
      <nav class="foot-links" aria-label="Elsewhere">
        <a href="${REPO}">Source</a>
        <a href="https://www.npmjs.com/package/deckhq">npm</a>
        <a href="${REPO}/blob/main/CONTRIBUTING.md">Contributing</a>
        <a href="${REPO}/blob/main/SECURITY.md">Security</a>
        <a href="${REPO}/blob/main/CHANGELOG.md">Changelog</a>
        <a href="${REPO}/blob/main/LICENSE">Licence</a>
      </nav>
      <p class="foot-note">
        This site loads nothing from anywhere else. No fonts, no scripts, no analytics.
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
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'log'), { recursive: true });
  fs.mkdirSync(path.join(OUT, 'media'), { recursive: true });

  let written = 0;
  /** @param {string} rel @param {string} content */
  const write = (rel, content) => {
    fs.writeFileSync(path.join(OUT, rel), content);
    written++;
  };

  // The hand-written pages.
  for (const page of PAGES) {
    if (page.slug === 'log/index') continue;
    const body = read(path.join('site', 'pages', `${page.slug}.html`));
    write(`${page.slug}.html`, shell({ ...page, body, depth: 0 }));
  }

  // The engineering log.
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

  const media = new Set(MEDIA);
  for (const m of deviations.matchAll(/!\[[^\]]*\]\((media\/[^)\s]+)\)/g)) {
    media.add(path.basename(m[1]));
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

    const body = `      <article class="prose log-entry">
        <p class="log-back"><a href="index.html">Engineering log</a></p>
        <p class="log-number">${esc(entry.label)}</p>
        <h1>${inline(entry.heading, rewriteSrc, rewriteHref)}</h1>
${indentBlock(markdown(entry.body.join('\n'), { headingOffset: -1, rewriteSrc, rewriteHref }), 8)}
      </article>
      <nav class="pager" aria-label="Log entries">
        ${nav}
      </nav>`;

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

  // Static assets.
  fs.copyFileSync(path.join(here, 'style.css'), path.join(OUT, 'style.css'));
  fs.copyFileSync(path.join(here, 'favicon.svg'), path.join(OUT, 'favicon.svg'));
  written += 2;
  for (const name of media) {
    const from = path.join(root, 'docs', 'media', name);
    if (!fs.existsSync(from)) throw new Error(`docs/media/${name} is referenced but missing`);
    fs.copyFileSync(from, path.join(OUT, 'media', name));
    written++;
  }

  // GitHub Pages runs Jekyll over an upload unless told not to, and Jekyll
  // drops files and directories beginning with an underscore.
  write('.nojekyll', '');

  process.stdout.write(
    `site: ${written} files -> ${path.relative(root, OUT) || OUT}` +
      ` (${PAGES.length - 1} pages, ${items.length} log entries, ${media.size} images)\n`,
  );
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

export { markdown, inline, plain, splitEntries, safeUrl, build };
