/**
 * BOTH LOOK SURFACES OVER ONE STORE, with no browser.
 *
 * The settings sheet's Look section and the header's Look bar each take their
 * `document` as a parameter, and the shell hands both the SAME look store.
 * `world()` builds exactly that — the real catalogue, the real guard, the real
 * store, both surfaces — over a document that makes nodes, remembers which one
 * has the keyboard and can be fired at; the post is captured rather than sent.
 *
 * NO jsdom, `look-ui.test.mjs`'s rule. `settings-ui-widgets.js` reaches for the
 * global `document` inside its functions, so `world()` installs the stub there
 * too: the rows under test are the sheet's own rows.
 */
import * as catalogue from '../../public/render/look-options.js';
import { DEFAULT_LOOK, normalizeLook } from '../../public/render/look-options.js';
import { lookMetrics, validateLook } from '../../public/render/look-guards.js';
import { THEMES } from '../../public/render/themes.js';
import { createLookSection } from '../../public/look-ui.js';
import { createLookBar } from '../../public/look-ui-bar.js';
import { createLookStore } from '../../public/look-ui-store.js';
import { createSettingsWidgets } from '../../public/settings-ui-widgets.js';

// --------------------------------------------------------------- DOM stub

export class StubNode {
  /** @param {string} tagName @param {any} doc */
  constructor(tagName, doc) {
    this.tagName = String(tagName).toUpperCase();
    this.doc = doc;
    this.children = [];
    this.parentNode = null;
    this.className = '';
    this.id = '';
    this.type = '';
    this.title = '';
    this.hidden = false;
    this.style = {};
    this.attrs = /** @type {Record<string,string>} */ ({});
    this.listeners = /** @type {Record<string, Function[]>} */ ({});
    this._text = null;
  }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  append(...kids) {
    for (const kid of kids) this.appendChild(kid);
  }
  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }
  addEventListener(name, fn) {
    (this.listeners[name] ||= []).push(fn);
  }
  removeEventListener(name, fn) {
    this.listeners[name] = (this.listeners[name] || []).filter((f) => f !== fn);
  }
  /** Fire one, the way a browser would. @param {string} name @param {any} [event] */
  fire(name, event = {}) {
    for (const fn of [...(this.listeners[name] || [])]) fn(event);
    return event;
  }
  focus() {
    this.doc.activeElement = this;
  }
  contains(node) {
    for (let n = node; n; n = n.parentNode) if (n === this) return true;
    return false;
  }
  set innerHTML(v) {
    throw new Error(`wrote ${JSON.stringify(String(v))} through innerHTML`);
  }
  set textContent(v) {
    this.children = [];
    this._text = String(v);
  }
  get textContent() {
    if (this.children.length > 0) return this.children.map((c) => c.textContent).join('');
    return this._text === null ? '' : this._text;
  }
}

export function stubDocument() {
  const doc = {
    activeElement: /** @type {any} */ (null),
    createElement: (/** @type {string} */ tag) => new StubNode(tag, doc),
    addEventListener() {},
    removeEventListener() {},
  };
  return doc;
}

/** Every node in a tree, depth first. */
export function all(node, out = []) {
  out.push(node);
  for (const child of node.children) all(child, out);
  return out;
}
export const byRole = (root, role) => all(root).filter((n) => n.getAttribute('role') === role);
export const byClass = (root, cls) =>
  all(root).filter((n) => String(n.className).split(/\s+/).includes(cls));
/** The radio group with this accessible name. */
export const group = (root, label) =>
  byRole(root, 'radiogroup').find((g) => g.getAttribute('aria-label') === label);
/** The radio in `g` labelled `text`. */
export const radio = (g, text) => byRole(g, 'radio').find((b) => b.textContent === text);
/** Which of a group's radios are checked, by label. */
export const checked = (g) =>
  byRole(g, 'radio')
    .filter((b) => b.getAttribute('aria-checked') === 'true')
    .map((b) => b.textContent);
/** The one switch on a surface. */
export const theSwitch = (root) => byRole(root, 'switch')[0];
/** The reasons a surface is showing. */
export const reasons = (root) => byRole(root, 'status').map((n) => n.textContent);
export const tick = () => new Promise((resolve) => setImmediate(resolve));

// ------------------------------------------------------------- the harness

/**
 * BOTH surfaces over ONE store, against the real catalogue and the real guard,
 * with the post captured rather than sent.
 *
 * @param {object} [opts]
 * @param {any} [opts.look]      what the daemon starts with
 * @param {any} [opts.validate]  a guard to stand in front of the real one
 * @param {any} [opts.theme]     the theme the floor is painted in: a name or a document
 */
export function world(opts = {}) {
  const doc = stubDocument();
  // `settings-ui-widgets.js` builds its rows with the global `document`.
  globalThis.document = /** @type {any} */ (doc);
  let stored = normalizeLook(opts.look || DEFAULT_LOOK);
  const pushed = { look: stored, theme: 'default', onboarded: true, seenLookHint: true };
  const posted = [];
  const port = {
    catalogue: () => catalogue,
    validate: opts.validate || validateLook,
    metrics: lookMetrics,
    theme: () => opts.theme || 'default',
    live: () => 9,
    picture: (/** @type {any} */ spec) => {
      const canvas = doc.createElement('canvas');
      canvas.spec = spec;
      return canvas;
    },
    apply: async (/** @type {any} */ next) => {
      posted.push(next);
      stored = normalizeLook(next);
      return { ok: true, look: stored };
    },
    exportLook: () => {},
    importLook: () => {},
  };
  const theming = { list: () => THEMES, apply: () => {}, swatches: () => [] };
  const saveSetting = async (/** @type {any} */ patch) => ({ ...pushed, ...patch });
  const store = createLookStore({ port, read: () => pushed, debounceMs: 0, theming, saveSetting });

  const widgets = createSettingsWidgets({
    theming,
    shippedThemes: () => [],
    applyThemeSetting: (/** @type {string} */ n) => n,
    availableAvatarSets: () => [],
  });
  const section = createLookSection({ doc, widgets, store, look: port, toast: () => {} });
  const host = doc.createElement('div');
  const sheet = () => {
    host.children = [];
    section.renderInto(host);
    return host;
  };
  section.wire({ render: sheet });

  const buttonEl = doc.createElement('button');
  const popoverEl = doc.createElement('div');
  popoverEl.hidden = true;
  const bar = createLookBar({
    doc,
    buttonEl,
    popoverEl,
    look: port,
    theming,
    getSettings: () => pushed,
    saveSetting,
    openSheet: () => {},
    store,
  });
  return { doc, store, port, posted, sheet, bar, popoverEl, look: () => stored };
}

/** The Advanced disclosure of a drawn sheet. */
export const advancedOf = (root) => byClass(root, 'settings-look-advanced')[0];
/** The cell of the modifier called `label`, under the cards. */
export const cellOf = (root, label) =>
  byClass(root, 'settings-look-mod').find((cell) =>
    byClass(cell, 'settings-label').some((n) => n.textContent === label),
  );

/**
 * A guard that refuses one value of one key with a sentence of the REAL
 * guard's, and is the real guard otherwise.
 * @param {string} key @param {string} value @param {any} problem
 */
export const refusing = (key, value, problem) => (next, theme) =>
  normalizeLook(next)[key] === value
    ? { ok: false, problems: [problem] }
    : validateLook(next, theme);
