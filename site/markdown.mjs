/**
 * Markdown for the changelog page, and nothing else.
 *
 * The converter is deliberately small: headings, paragraphs, lists, tables,
 * block quotes, rules, fenced code, and five inline forms. Everything is
 * escaped before anything is added, so a `<script>` in a release note renders
 * as the visible characters it is.
 *
 * It is a file of its own so that `site/build.mjs` is the pages and the shell,
 * and this is the one piece of it with rules worth testing in isolation.
 */

/** @param {unknown} s */
export const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

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
 * The release highlights, out of `CHANGELOG.md`.
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

export { markdown, inline, plain, safeUrl, releaseHighlights };
