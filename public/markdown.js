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
 * Coverage, on purpose no wider: headings, paragraphs, bullet and numbered
 * lists (nested by indentation), block quotes, fenced code, thematic breaks,
 * inline code, bold, italic, and links — which render as their text with the
 * URL visible beside it, never as an anchor. Anything else is a paragraph.
 *
 * `renderMarkdown()` takes the document to build with, so the same function
 * runs unchanged against a minimal DOM stub in Node (test/unit/markdown.test.mjs).
 */

/**
 * @typedef {{type:'text', text:string}
 *   | {type:'code', text:string}
 *   | {type:'strong', children:Inline[]}
 *   | {type:'em', children:Inline[]}
 *   | {type:'link', children:Inline[], href:string}} Inline
 * @typedef {{type:'heading', level:number, children:Inline[]}
 *   | {type:'paragraph', children:Inline[]}
 *   | {type:'code', lang:string, text:string}
 *   | {type:'list', ordered:boolean, start:number, items:Block[][]}
 *   | {type:'quote', children:Block[]}
 *   | {type:'hr'}} Block
 */

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const BULLET = /^(\s*)([-*+])\s+(.*)$/;
const NUMBERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;

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
      while (i < lines.length) {
        const cur = lines[i];
        const im = ordered ? NUMBERED.exec(cur) : BULLET.exec(cur);
        if (!im || im[1].length !== indent) break;
        // The item's own text plus every following line that is indented
        // deeper than the marker (continuations and nested lists), stripped
        // of that indentation so it parses as its own little document.
        const contentIndent = indent + im[2].length + 1;
        const chunk = [im[3]];
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
      out.push({ type: 'list', ordered, start, items });
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
    if (ch === '\\' && i + 1 < src.length && /[\\`*_[\]()#>~-]/.test(src[i + 1])) {
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
    if (ch === '[') {
      const m = /^\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(src.slice(i));
      if (m) {
        emitText();
        out.push({ type: 'link', children: parseInline(m[1]), href: m[2] });
        i += m[0].length;
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
      const pre = doc.createElement('pre');
      pre.className = 'md-pre';
      const code = doc.createElement('code');
      if (block.lang) code.setAttribute('data-lang', block.lang);
      code.textContent = block.text;
      pre.appendChild(code);
      return pre;
    }
    case 'list': {
      const list = doc.createElement(block.ordered ? 'ol' : 'ul');
      list.className = 'md-list';
      if (block.ordered && block.start !== 1) list.setAttribute('start', String(block.start));
      for (const item of block.items) {
        const li = doc.createElement('li');
        for (const child of item) li.appendChild(renderBlock(child, doc));
        list.appendChild(li);
      }
      return list;
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

/** @param {HTMLElement} parent @param {Inline[]} nodes @param {Document} doc */
function appendInline(parent, nodes, doc) {
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        parent.appendChild(doc.createTextNode(node.text));
        break;
      case 'code': {
        const code = doc.createElement('code');
        code.className = 'md-code';
        code.textContent = node.text;
        parent.appendChild(code);
        break;
      }
      case 'strong':
      case 'em': {
        const el = doc.createElement(node.type);
        appendInline(el, node.children, doc);
        parent.appendChild(el);
        break;
      }
      case 'link': {
        // Text plus the visible URL, never an anchor: nothing in the panel
        // navigates, and the reader sees exactly where the agent pointed.
        const span = doc.createElement('span');
        span.className = 'md-link';
        appendInline(span, node.children, doc);
        const url = doc.createElement('span');
        url.className = 'md-url';
        url.textContent = ` (${node.href})`;
        span.appendChild(url);
        parent.appendChild(span);
        break;
      }
    }
  }
}
