/**
 * What an address in a transcript may become (WP-100).
 *
 * Split out of `markdown.js`, which it would have taken to within sight of
 * the 900-line ceiling, and for a better reason than length: this is the part
 * of the renderer that is a SECURITY DECISION rather than a layout one. A
 * link, a bare word or a code span points at something, and these three pure
 * functions say what the page is allowed to do about it:
 *
 *   fileRefOf()     is this text a path, and which line of it
 *   classifyHref()  an anchor, a file to open, or just words
 *   needsSession()  something only the app the session runs in can show
 *
 * No DOM, no I/O, nothing imported — so every answer, including the answer
 * for every hostile address anybody thought of, is asserted in
 * `test/unit/markdown-rich.test.mjs`. `markdown.js` re-exports all three.
 */

/**
 * File extensions a bare `name.ext:12` is taken as a file for. A name with a
 * directory in front of it needs no entry here; this list exists so that
 * `example.com:8080` is a host and a port, and `panel.js:42` is a line.
 */
const SOURCE_EXT = new Set(
  (
    'js mjs cjs ts mts cts tsx jsx json jsonc md mdx css scss sass less html htm vue svelte astro ' +
    'py pyi rs go java kt kts rb php c h cc cpp hpp cs swift m mm sh bash zsh fish ps1 psm1 bat cmd ' +
    'yml yaml toml ini cfg conf env sql graphql gql proto xml svg txt lock gradle dart lua r ex exs ' +
    'erl hs clj scala pl zig nim tf ipynb'
  ).split(' '),
);

/** `path/to/name.ext:12`, `:12-20` or `:12:5`. Anchored; tried on short runs only. */
const FILE_LINE =
  /^((?:[A-Za-z]:)?[\w@.~+\\/-]*[\w@+-]\.([A-Za-z][A-Za-z0-9]{0,9})):(\d{1,7})(?:[-:]\d{1,7})?$/;
/** `path/to/name.ext` with no line — a path only if it has a directory in it. */
const FILE_ONLY = /^(?:[A-Za-z]:)?[\w@.~+\\/-]*[\\/][\w@.+-]*[\w@+-]\.[A-Za-z][A-Za-z0-9]{0,9}$/;

/**
 * Is this text a reference to a file — and to which line of it?
 *
 * `requireLine` is for running prose, where `docs/GUIDE.md` is as likely to be
 * a phrase as a path and only the `:42` makes it a reference. Inside a code
 * span or a link's address the writer has already said it is a path.
 *
 * @param {string} text
 * @param {{requireLine?:boolean}} [opts]
 * @returns {{path:string, line:number}|null}
 */
export function fileRefOf(text, opts = {}) {
  const s = String(text || '');
  // Bounded before any pattern sees it: this is untrusted text, and a path
  // nobody could type is not a path.
  if (s.length < 3 || s.length > 400 || /\s/.test(s) || s.includes('://')) return null;
  const m = FILE_LINE.exec(s);
  if (m) {
    const hasDir = /[\\/]/.test(m[1]);
    if (!hasDir && !SOURCE_EXT.has(m[2].toLowerCase())) return null;
    return { path: m[1], line: Number(m[3]) };
  }
  if (opts.requireLine) return null;
  return FILE_ONLY.test(s) ? { path: s, line: 1 } : null;
}

/**
 * What an address may become.
 *
 *   external  an `http:` or `https:` URL somewhere else — an anchor, new tab
 *   loopback  the same, on this machine — an anchor, marked as local
 *   file      a path — a control that opens it in the user's editor
 *   text      everything else, including every scheme that can run code —
 *             its words, with the address visible, and nothing to click
 *
 * The anchor's `href` is the URL as the platform's own parser re-serialised
 * it, never the string the transcript supplied.
 *
 * @param {string} href
 * @returns {{kind:'external'|'loopback', url:string}
 *   | {kind:'file', path:string, line:number} | {kind:'text'}}
 */
export function classifyHref(href) {
  const raw = String(href ?? '');
  // A browser strips tabs and newlines out of a scheme before reading it, so
  // `java\tscript:` is `javascript:`. Nothing with a control character or a
  // space in it is an address this file will act on.
  if (!raw || raw.length > 2000 || /[\u0000- \u007f-\u009f]/.test(raw)) return { kind: 'text' };
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(raw);
  // One letter and a colon is a Windows drive, not a scheme.
  if (scheme && scheme[1].length > 1) {
    const name = scheme[1].toLowerCase();
    if (name !== 'http' && name !== 'https') return { kind: 'text' };
    let url;
    try {
      url = new URL(raw);
    } catch {
      return { kind: 'text' };
    }
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) {
      return { kind: 'text' };
    }
    // `https://bank.example@evil.example/` reads as one site and goes to
    // another. Shown as text, so the whole address is in front of the reader.
    if (url.username || url.password) return { kind: 'text' };
    const host = url.hostname.toLowerCase();
    const local =
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host === '[::1]' ||
      /^127(?:\.\d{1,3}){3}$/.test(host);
    return { kind: local ? 'loopback' : 'external', url: url.href };
  }
  if (raw.startsWith('#') || raw.startsWith('//')) return { kind: 'text' };
  const file = fileRefOf(raw) || fileRefOf(raw.replace(/^\.\//, ''));
  if (file) return { kind: 'file', path: file.path, line: file.line };
  // `README.md`, `docs/guide` — a relative address with no scheme is a file
  // in the session's project or it is nothing this page can open.
  if (/^[\w@.~+-][\w@.~+\\/-]*\.[A-Za-z][A-Za-z0-9]{0,9}$/.test(raw)) {
    return { kind: 'file', path: raw, line: 1 };
  }
  return { kind: 'text' };
}

/**
 * Is this URL an artifact — something that only means anything in the app the
 * session is running in? One pattern, and it is a claim about an address, not
 * about a product: a claude.ai artifact link.
 * @param {string} url
 */
export function needsSession(url) {
  return /^https:\/\/claude\.ai\/(?:code\/)?artifacts?\//i.test(String(url || ''));
}
