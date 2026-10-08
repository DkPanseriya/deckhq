/**
 * The least DOM the panel's renderers need, for running them under `node
 * --test` (WP-100).
 *
 * It RECORDS: element names, classes, attributes and text, exactly as asked
 * for. It parses nothing — there is no `innerHTML` setter on it at all — so
 * the only way a `<script>` in a transcript could become an element here is
 * for a renderer to have created one, and a test that walks the tree would
 * find it. `test/unit/markdown.test.mjs` keeps its own older copy; this is the
 * one the WP-100 suites share.
 */
export class StubNode {
  /** @param {string} tagName */
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    /** @type {any[]} */
    this.children = [];
    /** @type {Record<string,string>} */
    this.attributes = {};
    this.className = '';
    this.hidden = false;
    this.open = false;
    /** @type {string|null} */
    this._text = null;
  }
  appendChild(child) {
    // As a real element does: text set earlier stays, as a text node, in front
    // of whatever is appended after it.
    if (this._text !== null) {
      const kept = this._text;
      this._text = null;
      if (kept) this.children.push(new StubText(kept));
    }
    this.children.push(child);
    return child;
  }
  append(...nodes) {
    for (const n of nodes) this.appendChild(typeof n === 'string' ? new StubText(n) : n);
  }
  setAttribute(k, v) {
    this.attributes[k] = String(v);
  }
  getAttribute(k) {
    return k in this.attributes ? this.attributes[k] : null;
  }
  set textContent(v) {
    this.children = [];
    this._text = String(v);
  }
  get textContent() {
    if (this._text !== null) return this._text;
    return this.children.map((c) => c.textContent).join('');
  }
}

export class StubText {
  /** @param {string} text */
  constructor(text) {
    this.tagName = '#text';
    this.textContent = String(text);
    this.children = [];
    this.attributes = {};
    this.className = '';
  }
}

/** A `document` with the two factories the renderers call. */
export const doc = /** @type {any} */ ({
  createElement: (tag) => new StubNode(tag),
  createTextNode: (text) => new StubText(text),
});

/** Every node in the tree, depth first. @param {any} node @param {any[]} [out] */
export function all(node, out = []) {
  out.push(node);
  for (const c of node.children || []) all(c, out);
  return out;
}

/** @param {any} root @param {string} tag */
export const byTag = (root, tag) => all(root).filter((n) => n.tagName === tag.toUpperCase());

/** @param {any} root @param {string} cls */
export const byClass = (root, cls) =>
  all(root).filter((n) =>
    String(n.className || '')
      .split(/\s+/)
      .includes(cls),
  );
