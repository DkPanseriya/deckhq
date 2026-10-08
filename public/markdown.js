/**
 * A small block-level markdown renderer for conversation text.
 *
 * docs/plan/05-GUI-UX-SPEC.md §4.2, docs/plan/06-ENGINEERING-WORKPLAN.md WP-08.
 *
 * Two stages, deliberately separate: `parseMarkdown()` turns text into a token
 * tree and touches no DOM at all, and `renderMarkdown()` builds elements from
 * that tree with `createElement` and `textContent`. There is no `innerHTML`
 * anywhere in this file and no regex that produces HTML — conversation text is
 * untrusted daemon data, and a `<script>` inside a fenced block is rendered as
 * the six visible characters it is. This is a security requirement
 * (docs/02-ARCHITECTURE.md §9; 07-AGENT-HANDOVERS.md rule 8), not a style.
 *
 * WP-100 widened the coverage to what a Claude Code reply actually contains,
 * after an audit against one (`test/fixtures/rich-transcript.mjs`): headings,
 * paragraphs, bullet and numbered lists (nested by indentation), TASK LISTS,
 * TABLES, block quotes, fenced code with its language, thematic breaks, inline
 * code, bold, italic, STRIKETHROUGH, links, bare URLS, IMAGES and FILE
 * REFERENCES (`src/x.js:42`). Anything else is a paragraph.
 *
 * THREE THINGS THIS FILE WILL NOT DO, each of them a rule:
 *
 * 1. **It never parses HTML.** There is no path from a `<` in a transcript to
 *    an element. `<img onerror=…>` is thirty visible characters.
 * 2. **It never makes an anchor out of anything but `http:` or `https:`.**
 *    `classifyHref()` decides, and every other scheme — `javascript:`,
 *    `data:`, `vbscript:`, `file:`, one nobody has heard of — is rendered as
 *    its text with the address visible beside it, exactly as every link was
 *    before WP-100. An anchor opens a new tab with `rel="noopener
 *    noreferrer"`, so the page it opens is handed nothing.
 * 3. **It never loads anything.** An image in a reply is a line that names it
 *    and a link to open it; there is no `<img>`, because fetching a picture a
 *    transcript named is an outbound request the user did not make
 *    (docs/02-ARCHITECTURE.md §9 — the core opens no outbound socket, and
 *    neither does its page on a transcript's say-so).
 *
 * The renderer builds three kinds of control and wires none of them: a `copy`
 * button on a code block, a file reference, and "open in the session". Each is
 * a `<button>` carrying `data-*` attributes; `panel-said.js` listens for the
 * click on the container. So this file still runs unchanged against a minimal
 * DOM stub in Node (test/unit/markdown.test.mjs), and what a click does is
 * decided where the session is known.
 */

/**
 * @typedef {{type:'text', text:string}
 *   | {type:'code', text:string}
 *   | {type:'strong', children:Inline[]}
 *   | {type:'em', children:Inline[]}
 *   | {type:'del', children:Inline[]}
 *   | {type:'link', children:Inline[], href:string}
 *   | {type:'image', alt:string, src:string}
 *   | {type:'file', text:string, path:string, line:number}} Inline
 * @typedef {{type:'heading', level:number, children:Inline[]}
 *   | {type:'paragraph', children:Inline[]}
 *   | {type:'code', lang:string, text:string}
 *   | {type:'list', ordered:boolean, start:number, items:Block[][], checks?:(boolean|null)[]}
 *   | {type:'table', align:('left'|'right'|'center'|null)[], head:Inline[][], rows:Inline[][][]}
 *   | {type:'quote', children:Block[]}
 *   | {type:'hr'}} Block
 */

import { classifyHref, fileRefOf, needsSession } from './markdown-links.js';

// The three address rules live in `markdown-links.js`; re-exported so nothing
// that reads a transcript has to know there are two files.
export { classifyHref, fileRefOf, needsSession };

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const BULLET = /^(\s*)([-*+])\s+(.*)$/;
const NUMBERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const TASK = /^\[([ xX])\]\s+(.*)$/;
/** A table's second line: `| :--- | ---: |`. Dashes, optional colons, pipes. */
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

/**
 * @param {string} text
 * @returns {Block[]}
 */
export function parseMarkdown(text) {
  return parseBlocks(
    String(text ?? '')
      .replace(/\r\n?/g, '\n')
      .split('\n'),
  );
}

/**
 * One table row as its cells' raw text. A pipe inside a code span or behind a
 * backslash is part of the cell; the row's own outer pipes are not cells.
 * @param {string} line
 * @returns {string[]}
 */
function splitRow(line) {
  const cells = [];
  let cur = '';
  let inCode = false;
  const s = line.trim();
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && s[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (ch === '`') {
      inCode = !inCode;
      cur += ch;
    } else if (ch === '|' && !inCode) {
      cells.push(cur);
      cur = '';
    } else cur += ch;
  }
  cells.push(cur);
  if (cells.length && !cells[0].trim()) cells.shift();
  if (cells.length && !cells[cells.length - 1].trim()) cells.pop();
  return cells.map((c) => c.trim());
}

/** @param {string[]} lines @returns {Block[]} */
function parseBlocks(lines) {
  /** @type {Block[]} */
  const out = [];
  /** @type {string[]} */
  let para = [];
  const flush = () => {
    if (para.length) out.push({ type: 'paragraph', children: parseInline(para.join('\n')) });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      flush();
      continue;
    }
    let m;
    if ((m = FENCE.exec(line))) {
      flush();
      const marker = m[1];
      const lang = m[2].trim();
      const body = [];
      i++;
      while (i < lines.length) {
        const close = FENCE.exec(lines[i]);
        if (
          close &&
          close[1][0] === marker[0] &&
          close[1].length >= marker.length &&
          !close[2].trim()
        )
          break;
        body.push(lines[i]);
        i++;
      }
      out.push({ type: 'code', lang, text: body.join('\n') });
      continue;
    }
    if ((m = HEADING.exec(line))) {
      flush();
      out.push({ type: 'heading', level: m[1].length, children: parseInline(m[2]) });
      continue;
    }
    if (HR.test(line)) {
      flush();
      out.push({ type: 'hr' });
      continue;
    }
    // A table is a line with a pipe in it, followed by a rule line with as
    // many columns. Without the rule it is a sentence with a pipe in it.
    if (line.includes('|') && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1])) {
      const head = splitRow(line);
      const rule = splitRow(lines[i + 1]);
      if (head.length > 0 && rule.length === head.length) {
        flush();
        const align = rule.map((cell) => {
          const left = cell.startsWith(':');
          const right = cell.endsWith(':');
          return left && right ? 'center' : right ? 'right' : left ? 'left' : null;
        });
        /** @type {Inline[][][]} */
        const rows = [];
        i += 2;
        while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
          const cells = splitRow(lines[i]);
          // Short rows are padded and long ones cut, so a ragged table is
          // still a table and never a column that runs off the head.
          while (cells.length < head.length) cells.push('');
          rows.push(cells.slice(0, head.length).map((c) => parseInline(c)));
          i++;
        }
        i--;
        out.push({ type: 'table', align, head: head.map((c) => parseInline(c)), rows });
        continue;
      }
    }
    if (QUOTE.test(line)) {
      flush();
      const inner = [];
      while (i < lines.length && (m = QUOTE.exec(lines[i]))) {
        inner.push(m[1]);
        i++;
      }
      i--;
      out.push({ type: 'quote', children: parseBlocks(inner) });
      continue;
    }
    if ((m = BULLET.exec(line) || NUMBERED.exec(line))) {
      flush();
      const ordered = /\d/.test(m[2]);
      const indent = m[1].length;
      const start = ordered ? Number(m[2]) : 1;
      /** @type {Block[][]} */
      const items = [];
      /** @type {(boolean|null)[]} */
      const checks = [];
      while (i < lines.length) {
        const cur = lines[i];
        if (!cur.trim()) {
          // A LOOSE list: a blank line between two items of the same list is
          // spacing, not the end of it. Without this `1. … 2. … (blank) 3. …`
          // was two lists, the second one starting at 3.
          const after = lines[i + 1];
          const sibling =
            after !== undefined && (ordered ? NUMBERED.exec(after) : BULLET.exec(after));
          if (sibling && sibling[1].length === indent) {
            i++;
            continue;
          }
          break;
        }
        const im = ordered ? NUMBERED.exec(cur) : BULLET.exec(cur);
        if (!im || im[1].length !== indent) break;
        // The item's own text plus every following line that is indented
        // deeper than the marker (continuations and nested lists), stripped
        // of that indentation so it parses as its own little document.
        const contentIndent = indent + im[2].length + 1;
        // `- [x] done` is a task: the box is the item's state, not its text.
        const task = TASK.exec(im[3]);
        checks.push(task ? task[1] !== ' ' : null);
        const chunk = [task ? task[2] : im[3]];
        i++;
        while (i < lines.length) {
          const next = lines[i];
          if (!next.trim()) {
            // A blank line ends the item unless deeper-indented content follows.
            const after = lines[i + 1];
            if (after !== undefined && leadingSpaces(after) > indent && after.trim()) {
              chunk.push('');
              i++;
              continue;
            }
            break;
          }
          if (leadingSpaces(next) <= indent) break;
          chunk.push(next.slice(Math.min(contentIndent, leadingSpaces(next))));
          i++;
        }
        items.push(parseBlocks(chunk));
      }
      i--;
      /** @type {Block} */
      const list = { type: 'list', ordered, start, items };
      if (checks.some((c) => c !== null)) list.checks = checks;
      out.push(list);
      continue;
    }
    para.push(line);
  }
  flush();
  return out;
}

/** @param {string} s */
function leadingSpaces(s) {
  return /^\s*/.exec(s)[0].length;
}

/**
 * `[words](address)` and `![alt](address)`. The address may hold one level of
 * its own brackets — `…/wiki/A_(b)`, `javascript:alert(1)` — so the link ends
 * where the writer ended it and not at the first `)` inside it. Bounded: an
 * address is at most 2000 characters and never spans a space.
 */
const LINK = /^\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\)){1,2000})(?:\s+"[^"\n]*")?\)/;
const IMAGE = /^!\[([^\]\n]*)\]\(((?:[^()\s]|\([^()\s]*\)){1,2000})(?:\s+"[^"\n]*")?\)/;

/** Where a word can start: the beginning, or after a space or an opener. */
const WORD_START = /[\s([{"'“‘>|]/;
/** The longest run a bare URL or a file reference is looked for in. */
const RUN = /[^\s<>"'`]{1,400}/y;

/**
 * A bare URL or `file.ext:12` beginning at `i`, as a token and how many
 * characters it took — or null. Trailing punctuation belongs to the sentence.
 * @param {string} src @param {number} i
 * @returns {{node:Inline, length:number}|null}
 */
function bareAddress(src, i) {
  if (i > 0 && !WORD_START.test(src[i - 1])) return null;
  RUN.lastIndex = i;
  const m = RUN.exec(src);
  if (!m) return null;
  let run = m[0];
  const isUrl = /^https?:\/\//i.test(run);
  if (!isUrl && !/\.[A-Za-z][A-Za-z0-9]{0,9}:\d/.test(run)) return null;
  // `(see https://example.com/x).` — the bracket and the full stop are prose,
  // unless the URL opened a bracket of its own.
  for (;;) {
    const last = run[run.length - 1];
    if (/[.,;:!?*_~]/.test(last)) run = run.slice(0, -1);
    else if (last === ')' && !run.includes('(')) run = run.slice(0, -1);
    else if (last === ']' && !run.includes('[')) run = run.slice(0, -1);
    else break;
    if (!run) return null;
  }
  if (isUrl) {
    if (classifyHref(run).kind === 'text') return null;
    return {
      node: { type: 'link', children: [{ type: 'text', text: run }], href: run },
      length: run.length,
    };
  }
  const file = fileRefOf(run, { requireLine: true });
  if (!file) return null;
  return {
    node: { type: 'file', text: run, path: file.path, line: file.line },
    length: run.length,
  };
}

/**
 * Inline parsing by a single left-to-right scan. Code spans win over every
 * other marker, so `**` inside backticks stays literal.
 * @param {string} src
 * @returns {Inline[]}
 */
export function parseInline(src) {
  /** @type {Inline[]} */
  const out = [];
  let text = '';
  const emitText = () => {
    if (text) out.push({ type: 'text', text });
    text = '';
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\' && i + 1 < src.length && /[\\`*_[\]()#>~|!-]/.test(src[i + 1])) {
      text += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === '`') {
      const run = /^`+/.exec(src.slice(i))[0];
      const close = src.indexOf(run, i + run.length);
      if (close !== -1) {
        emitText();
        out.push({ type: 'code', text: src.slice(i + run.length, close).replace(/\n/g, ' ') });
        i = close + run.length;
        continue;
      }
    }
    if (ch === '!' && src[i + 1] === '[') {
      const m = IMAGE.exec(src.slice(i));
      if (m) {
        emitText();
        out.push({ type: 'image', alt: m[1], src: m[2] });
        i += m[0].length;
        continue;
      }
    }
    if (ch === '[') {
      const m = LINK.exec(src.slice(i));
      if (m) {
        emitText();
        out.push({ type: 'link', children: parseInline(m[1]), href: m[2] });
        i += m[0].length;
        continue;
      }
    }
    if (ch === '<') {
      // `<https://example.com>` — the one angle-bracket form that is markdown.
      const m = /^<(https?:\/\/[^\s<>]{1,2000})>/i.exec(src.slice(i));
      if (m && classifyHref(m[1]).kind !== 'text') {
        emitText();
        out.push({ type: 'link', children: [{ type: 'text', text: m[1] }], href: m[1] });
        i += m[0].length;
        continue;
      }
    }
    if (/[A-Za-z0-9._~/\\@-]/.test(ch)) {
      const bare = bareAddress(src, i);
      if (bare) {
        emitText();
        out.push(bare.node);
        i += bare.length;
        continue;
      }
    }
    if (ch === '~' && src[i + 1] === '~') {
      const close = findClose(src, i + 2, '~~');
      if (close !== -1) {
        emitText();
        out.push({ type: 'del', children: parseInline(src.slice(i + 2, close)) });
        i = close + 2;
        continue;
      }
    }
    // `_` never opens or closes inside a word (snake_case_name is literal); `*` may.
    const wordBefore = i > 0 && /\w/.test(src[i - 1]);
    if (ch === '*' || (ch === '_' && !wordBefore)) {
      const double = src[i + 1] === ch;
      const marker = double ? ch + ch : ch;
      const close = findClose(src, i + marker.length, marker);
      if (close !== -1 && !(ch === '_' && /\w/.test(src[close + marker.length] || ''))) {
        emitText();
        out.push({
          type: double ? 'strong' : 'em',
          children: parseInline(src.slice(i + marker.length, close)),
        });
        i = close + marker.length;
        continue;
      }
    }
    text += ch;
    i++;
  }
  emitText();
  return out;
}

/**
 * The next closing emphasis marker that ends a non-empty span and is not
 * preceded by whitespace (so `a * b * c` stays literal).
 * @param {string} src @param {number} from @param {string} marker
 */
function findClose(src, from, marker) {
  if (from >= src.length || /\s/.test(src[from])) return -1;
  let j = from;
  while ((j = src.indexOf(marker, j)) !== -1) {
    if (j > from && !/\s/.test(src[j - 1]) && src[j + marker.length] !== marker[0]) return j;
    j += 1;
  }
  return -1;
}

/**
 * Build DOM for a token tree. Only `createElement`, `createTextNode`,
 * `appendChild`, `className`, `setAttribute` and `textContent` are used.
 * @param {string} text
 * @param {Document} doc
 * @returns {HTMLElement} a `div.md` containing the rendered blocks
 */
export function renderMarkdown(text, doc = document) {
  const root = doc.createElement('div');
  root.className = 'md';
  for (const block of parseMarkdown(text)) root.appendChild(renderBlock(block, doc));
  return root;
}

/**
 * A control the panel wires by its class and `data-*` — never a listener here.
 * @param {Document} doc @param {string} className @param {string} label
 */
function control(doc, className, label) {
  const btn = doc.createElement('button');
  btn.setAttribute('type', 'button');
  btn.className = className;
  btn.textContent = label;
  return btn;
}

/**
 * "open in the session" — for the things a page cannot show and the app the
 * session runs in can: an artifact, a picture on the user's disk.
 * @param {Document} doc
 */
export function inSessionControl(doc) {
  const btn = control(doc, 'md-in-session', 'open in the session');
  btn.setAttribute('data-go', 'session');
  return btn;
}

/** @param {Block} block @param {Document} doc */
function renderBlock(block, doc) {
  switch (block.type) {
    case 'heading': {
      const h = doc.createElement(`h${Math.min(6, block.level + 3)}`);
      h.className = `md-h md-h${block.level}`;
      appendInline(h, block.children, doc);
      return h;
    }
    case 'code': {
      // A label and a copy button over the block, and the block itself
      // scrolls sideways: wrapped code is not the code that was written.
      const wrap = doc.createElement('div');
      wrap.className = 'md-codeblock';
      const head = doc.createElement('div');
      head.className = 'md-code-head';
      const lang = doc.createElement('span');
      lang.className = 'md-code-lang';
      // The first word only: a fence's info string can carry anything.
      lang.textContent = (block.lang.split(/\s+/)[0] || 'text').slice(0, 24);
      head.appendChild(lang);
      head.appendChild(control(doc, 'md-copy', 'copy'));
      const pre = doc.createElement('pre');
      pre.className = 'md-pre';
      const code = doc.createElement('code');
      if (block.lang) code.setAttribute('data-lang', block.lang);
      code.textContent = block.text;
      pre.appendChild(code);
      wrap.appendChild(head);
      wrap.appendChild(pre);
      return wrap;
    }
    case 'list': {
      const list = doc.createElement(block.ordered ? 'ol' : 'ul');
      list.className = block.checks ? 'md-list md-list--tasks' : 'md-list';
      if (block.ordered && block.start !== 1) list.setAttribute('start', String(block.start));
      block.items.forEach((item, index) => {
        const li = doc.createElement('li');
        const checked = block.checks ? block.checks[index] : null;
        if (checked !== null && checked !== undefined) {
          // A box that is drawn, not an input: nothing in a transcript is a
          // form, and ticking it would change nothing anywhere.
          li.className = checked ? 'md-task md-task--done' : 'md-task';
          const box = doc.createElement('span');
          box.className = 'md-check';
          box.setAttribute('role', 'img');
          box.setAttribute('aria-label', checked ? 'done' : 'not done');
          box.textContent = checked ? '☑' : '☐';
          li.appendChild(box);
        }
        for (const child of item) li.appendChild(renderBlock(child, doc));
        list.appendChild(li);
      });
      return list;
    }
    case 'table': {
      // Scrolls inside its own box, so a wide table never widens the card.
      const wrap = doc.createElement('div');
      wrap.className = 'md-table-wrap';
      const table = doc.createElement('table');
      table.className = 'md-table';
      /** @param {string} tag @param {Inline[][]} cells */
      const row = (tag, cells) => {
        const tr = doc.createElement('tr');
        cells.forEach((cell, col) => {
          const el = doc.createElement(tag);
          const align = block.align[col];
          if (align) el.className = `md-al-${align}`;
          appendInline(el, cell, doc);
          tr.appendChild(el);
        });
        return tr;
      };
      const thead = doc.createElement('thead');
      thead.appendChild(row('th', block.head));
      table.appendChild(thead);
      const tbody = doc.createElement('tbody');
      for (const cells of block.rows) tbody.appendChild(row('td', cells));
      table.appendChild(tbody);
      wrap.appendChild(table);
      return wrap;
    }
    case 'quote': {
      const q = doc.createElement('blockquote');
      q.className = 'md-quote';
      for (const child of block.children) q.appendChild(renderBlock(child, doc));
      return q;
    }
    case 'hr':
      return doc.createElement('hr');
    default: {
      const p = doc.createElement('p');
      p.className = 'md-p';
      appendInline(p, block.children, doc);
      return p;
    }
  }
}

/**
 * A reference to a file, as a control that opens it. The path and the line
 * travel as data; `POST /api/open-in-editor` decides whether the path is
 * inside the session's repository, and which program "the editor" means.
 * @param {Document} doc @param {string} label @param {string} path @param {number} line
 * @param {boolean} [asCode]
 */
function fileControl(doc, label, path, line, asCode) {
  const btn = control(doc, asCode ? 'md-fileref md-fileref--code' : 'md-fileref', label);
  btn.setAttribute('data-file', path);
  btn.setAttribute('data-line', String(line));
  btn.setAttribute('title', `Open ${path} at line ${line} in your editor`);
  return btn;
}

/**
 * Words with the address visible beside them and nothing to click — what
 * every link was before WP-100, and what every address that is not a web page
 * or a file still is.
 * @param {HTMLElement} parent @param {Inline[]} children @param {string} href @param {Document} doc
 */
function inertLink(parent, children, href, doc) {
  const span = doc.createElement('span');
  span.className = 'md-link';
  appendInline(span, children, doc);
  const url = doc.createElement('span');
  url.className = 'md-url';
  url.textContent = ` (${href})`;
  span.appendChild(url);
  parent.appendChild(span);
}

/** @param {Inline[]} nodes @returns {string} */
function plainText(nodes) {
  return nodes
    .map((n) =>
      n.type === 'text' || n.type === 'code' || n.type === 'file'
        ? n.text
        : n.type === 'image'
          ? n.alt
          : plainText(n.children),
    )
    .join('');
}

/** @param {HTMLElement} parent @param {Inline[]} nodes @param {Document} doc */
function appendInline(parent, nodes, doc) {
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        parent.appendChild(doc.createTextNode(node.text));
        break;
      case 'code': {
        // `src/x.js:42` in backticks is how a path is usually written. It
        // still reads as code; it is also somewhere you can go.
        const file = fileRefOf(node.text);
        if (file) {
          parent.appendChild(fileControl(doc, node.text, file.path, file.line, true));
          break;
        }
        const code = doc.createElement('code');
        code.className = 'md-code';
        code.textContent = node.text;
        parent.appendChild(code);
        break;
      }
      case 'strong':
      case 'em':
      case 'del': {
        const el = doc.createElement(node.type);
        appendInline(el, node.children, doc);
        parent.appendChild(el);
        break;
      }
      case 'file':
        parent.appendChild(fileControl(doc, node.text, node.path, node.line));
        break;
      case 'link': {
        const where = classifyHref(node.href);
        if (where.kind === 'external' || where.kind === 'loopback') {
          const a = doc.createElement('a');
          a.className = where.kind === 'loopback' ? 'md-a md-a--local' : 'md-a';
          a.setAttribute('href', where.url);
          a.setAttribute('target', '_blank');
          a.setAttribute('rel', 'noopener noreferrer');
          // Where it goes is one hover away, whatever the words say.
          a.setAttribute('title', where.url);
          appendInline(a, node.children, doc);
          parent.appendChild(a);
          if (needsSession(where.url)) {
            parent.appendChild(doc.createTextNode(' '));
            parent.appendChild(inSessionControl(doc));
          }
        } else if (where.kind === 'file') {
          parent.appendChild(
            fileControl(doc, plainText(node.children) || node.href, where.path, where.line),
          );
        } else {
          inertLink(parent, node.children, node.href, doc);
        }
        break;
      }
      case 'image': {
        // Named, never fetched. See rule 3 in the header.
        const span = doc.createElement('span');
        span.className = 'md-image';
        const mark = doc.createElement('span');
        mark.className = 'md-image-mark';
        mark.setAttribute('aria-hidden', 'true');
        mark.textContent = '▣ ';
        span.appendChild(mark);
        span.appendChild(doc.createTextNode(node.alt ? `image: ${node.alt}` : 'image'));
        const where = classifyHref(node.src);
        span.appendChild(doc.createTextNode(' '));
        if (where.kind === 'external' || where.kind === 'loopback') {
          const a = doc.createElement('a');
          a.className = 'md-a';
          a.setAttribute('href', where.url);
          a.setAttribute('target', '_blank');
          a.setAttribute('rel', 'noopener noreferrer');
          a.setAttribute('title', where.url);
          a.textContent = 'open';
          span.appendChild(a);
        } else {
          span.appendChild(inSessionControl(doc));
        }
        parent.appendChild(span);
        break;
      }
    }
  }
}
