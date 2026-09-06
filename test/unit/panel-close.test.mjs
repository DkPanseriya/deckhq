/**
 * WP-61 · closing the review card must close the card and nothing else.
 *
 * The bug this file exists to stop: `public/panel-dom.js` built the ✕ button
 * and registered `closeBtn.addEventListener('click', () => close())` on it.
 * `close` is `panel.js`'s local function, and `panel-dom.js` has no such
 * binding — so the identifier did not fail to resolve, it resolved to the
 * global `window.close`, and clicking ✕ closed the browser tab. Reproduced
 * over CDP by `scripts/repro-panel-close.mjs`: page targets 1 -> 0.
 *
 * Nothing caught it. `tsc` is happy because `close` is declared in
 * `lib.dom.d.ts`; eslint is happy because it is a browser global; the panel
 * still closed, because `panel.js` registers the correct listener on the same
 * button, so the visible behaviour was right and the tab died beside it.
 *
 * Two gates, because the shapes of the two failures are different:
 *
 *   1. **The panel is built and driven** against a DOM stub whose window has
 *      `close`, `open`, `print`, `stop` and the three `history` navigations
 *      replaced by counters. Every close path the card offers is run, and
 *      every counter must still be zero.
 *   2. **Every client module is read**, and a bare call to one of those
 *      globals is an error unless the module declares a binding of that name.
 *      That is the static half: it catches the same mistake in a module this
 *      test never instantiates.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, '../../public');

// --------------------------------------------------------------- DOM stub
//
// Enough of an element to build the card, click things on it and read back
// what happened. Nothing here parses HTML and nothing navigates.

class StubNode {
  /** @param {string} tagName */
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    /** @type {StubNode|null} */
    this.parentNode = null;
    this.className = '';
    this.id = '';
    this.hidden = false;
    this.value = '';
    this.title = '';
    this.rows = 0;
    this.width = 0;
    this.height = 0;
    this.tabIndex = 0;
    this.placeholder = '';
    this.dataset = {};
    this.style = {};
    this.attrs = /** @type {Record<string,string>} */ ({});
    /** @type {Record<string, Function[]>} */
    this.listeners = {};
    this._text = null;
    this.classList = {
      add: (/** @type {string} */ c) => {
        const set = new Set(String(this.className).split(/\s+/).filter(Boolean));
        set.add(c);
        this.className = [...set].join(' ');
      },
      remove: (/** @type {string} */ c) => {
        this.className = String(this.className)
          .split(/\s+/)
          .filter((x) => x && x !== c)
          .join(' ');
      },
      toggle: (/** @type {string} */ c, /** @type {boolean} */ on) =>
        on ? this.classList.add(c) : this.classList.remove(c),
      contains: (/** @type {string} */ c) => String(this.className).split(/\s+/).includes(c),
    };
  }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  append(...kids) {
    for (const k of kids) this.appendChild(k);
  }
  removeChild(child) {
    this.children = this.children.filter((c) => c !== child);
    return child;
  }
  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }
  removeAttribute(name) {
    delete this.attrs[name];
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  removeEventListener(type, fn) {
    this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn);
  }
  dispatchEvent(ev) {
    for (const fn of this.listeners[ev?.type] || []) fn(ev);
    return true;
  }
  click() {
    this.dispatchEvent({ type: 'click', target: this, preventDefault() {}, stopPropagation() {} });
  }
  focus() {}
  blur() {}
  scrollIntoView() {}
  setSelectionRange() {}
  getBoundingClientRect() {
    return { top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 };
  }
  getContext() {
    return null;
  }
  contains(node) {
    for (let n = node; n; n = n.parentNode) if (n === this) return true;
    return false;
  }
  closest(sel) {
    for (let n = this; n; n = n.parentNode) if (matches(n, sel)) return n;
    return null;
  }
  querySelector(sel) {
    return descendants(this).find((n) => matches(n, sel)) || null;
  }
  querySelectorAll(sel) {
    return descendants(this).filter((n) => matches(n, sel));
  }
  set textContent(v) {
    for (const c of this.children) c.parentNode = null;
    this.children = [];
    this._text = String(v);
  }
  get textContent() {
    if (this._text !== null && this.children.length === 0) return this._text;
    return (this._text ?? '') + this.children.map((c) => c.textContent).join('');
  }
  get isContentEditable() {
    return false;
  }
}

/** Every node under `root`, itself excluded. @param {StubNode} root */
function descendants(root, out = []) {
  for (const c of root.children) {
    out.push(c);
    descendants(c, out);
  }
  return out;
}

/**
 * The sliver of CSS selector syntax the panel actually uses — four selectors
 * in all (`.panel-more-btn`, `.btn--weighted`, `button`, `dialog[open]`): a
 * tag, a class, an id and an `[attr="value"]` filter, in any combination.
 * There are no descendant combinators in the client, so there are none here.
 * @param {StubNode} node @param {string} sel
 */
function matches(node, sel) {
  const parts =
    String(sel)
      .trim()
      .match(/^[a-zA-Z]+|[.#][\w-]+|\[[^\]]+\]/g) || [];
  for (const p of parts) {
    if (p.startsWith('.')) {
      if (!node.classList.contains(p.slice(1))) return false;
    } else if (p.startsWith('#')) {
      if (node.id !== p.slice(1)) return false;
    } else if (p.startsWith('[')) {
      const m = p.slice(1, -1).match(/^([\w-]+)(?:\s*=\s*["']?(.*?)["']?)?$/);
      if (!m) return false;
      const got = node.getAttribute(m[1]);
      if (got === null) return false;
      if (m[2] !== undefined && got !== m[2]) return false;
    } else if (node.tagName !== p.toUpperCase()) {
      return false;
    }
  }
  return parts.length > 0;
}

/** The window-closing globals, and how many times each was reached. */
const TRAPPED = ['close', 'open', 'print', 'stop', 'back', 'forward', 'go'];

/**
 * Install a document, a window and the traps; return the counters and an
 * `undo` that puts every global back exactly as it was.
 */
function installStubWindow() {
  /** @type {Record<string, number>} */
  const reached = Object.fromEntries(TRAPPED.map((k) => [k, 0]));
  const doc = new StubNode('body');
  doc.hidden = false;
  const document = {
    createElement: (/** @type {string} */ tag) => new StubNode(tag),
    createTextNode: (/** @type {string} */ t) => {
      const n = new StubNode('#text');
      n.textContent = t;
      return n;
    },
    addEventListener: (t, fn) => doc.addEventListener(t, fn),
    removeEventListener: (t, fn) => doc.removeEventListener(t, fn),
    dispatchEvent: (ev) => doc.dispatchEvent(ev),
    querySelector: (sel) => doc.querySelector(sel),
    querySelectorAll: (sel) => doc.querySelectorAll(sel),
    getElementById: (id) => doc.querySelector(`#${id}`),
    body: doc,
    hidden: false,
    activeElement: null,
  };

  const saved = new Map();
  const set = (name, value) => {
    saved.set(name, { had: name in globalThis, value: globalThis[name] });
    Object.defineProperty(globalThis, name, {
      value,
      configurable: true,
      writable: true,
    });
  };
  set('document', document);
  set('close', () => void reached.close++);
  set('open', () => {
    reached.open++;
    return null;
  });
  set('print', () => void reached.print++);
  set('stop', () => void reached.stop++);
  set('history', {
    length: 1,
    back: () => void reached.back++,
    forward: () => void reached.forward++,
    go: () => void reached.go++,
    pushState: () => {},
    replaceState: () => {},
  });
  set('location', {
    href: 'http://127.0.0.1:4317/',
    assign: () => assert.fail('a close path navigated with location.assign()'),
    replace: () => assert.fail('a close path navigated with location.replace()'),
    reload: () => assert.fail('a close path navigated with location.reload()'),
  });
  set(
    'EventSource',
    class {
      constructor() {
        this.readyState = 0;
      }
      addEventListener() {}
      close() {}
    },
  );
  set('fetch', async () => ({ ok: true, status: 200, json: async () => ({}) }));

  const undo = () => {
    for (const [name, prev] of saved) {
      if (prev.had)
        Object.defineProperty(globalThis, name, {
          value: prev.value,
          configurable: true,
          writable: true,
        });
      else delete globalThis[name];
    }
  };
  return { reached, document, root: doc, undo };
}

// --------------------------------------------------- 1 · the panel, driven

const AGENT = {
  id: 'claude-code:abc',
  mk: 'MK1.1',
  label: 'Ada',
  displayName: 'Ada',
  title: 'orbital-api',
  projectId: 'orbital-api',
  projectName: 'orbital-api',
  runtime: 'claude-code',
  ackState: 'active',
  activityState: 'for_review',
  reviewSince: Date.now() - 3600_000,
  tokens: 1000,
  lastText: 'Done.',
};

test('WP-61: no close path in the panel reaches a window-closing API', async () => {
  const stub = installStubWindow();
  try {
    const { createPanel } = await import('../../public/panel.js');
    const root = new StubNode('aside');
    root.id = 'panel';
    root.hidden = true;
    const snapshot = { agents: [AGENT], settings: {}, counts: {}, scannedAt: Date.now() };
    let closedCalls = 0;
    const panel = createPanel({
      root: /** @type {any} */ (root),
      getSnapshot: () => snapshot,
      toast: () => {},
      announce: () => {},
      onClosed: () => void closedCalls++,
    });

    // Path 1 · the ✕ button, which is the one that was broken.
    panel.open(AGENT.id);
    assert.equal(root.hidden, false, 'the panel should be open');
    const closeBtn = root
      .querySelectorAll('button')
      .find((b) => b.getAttribute('aria-label') === 'Close panel');
    assert.ok(closeBtn, 'the card has a ✕ button');
    closeBtn.click();
    assert.equal(root.hidden, true, 'the ✕ button closes the card');
    assert.equal(closedCalls, 1, 'and tells the host it closed');

    // Path 2 · Escape, a click on the floor, and J/K then Escape. All three
    // arrive at exactly one function — `selectAgent(null)` in app-state.js
    // calls `panel.close()` — so the panel-side path is driven once here and
    // the routing is asserted by `deck-keys.test.mjs` and `app-keys.js`.
    panel.open(AGENT.id);
    panel.close();
    assert.equal(root.hidden, true, 'close() closes the card');

    // Path 3 · every other control the open card offers. A close-shaped bug
    // hiding on the ⋯ menu or a weighted button would never be found by
    // pressing ✕, so they are all pressed.
    panel.open(AGENT.id);
    for (const btn of root.querySelectorAll('button')) btn.click();

    // Path 4 · destroy, which is what app.js runs when the tab goes away.
    panel.destroy();

    const hit = TRAPPED.filter((k) => stub.reached[k] > 0);
    assert.deepEqual(
      hit,
      [],
      `a close path reached ${hit.map((h) => `window.${h}()`).join(', ')} — ` +
        'see docs/DEVIATIONS.md §143',
    );

    // `createPanel()` kicks off `loadRenderModules()`, three dynamic imports
    // it deliberately does not await. Let them land before the globals go
    // back, or they land in a process with no `document` and the runner
    // reports asynchronous activity after the test.
    await new Promise((r) => setTimeout(r, 300));
  } finally {
    stub.undo();
  }
});

// ------------------------------------------------- 2 · every client module

/** Every `.js` under `public/`, recursively. */
function clientModules(dir = PUBLIC, out = /** @type {string[]} */ ([])) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) clientModules(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

/**
 * Comments and string literals, blanked out.
 *
 * Not decoration: half the panel's module headers say the words "never called
 * from open()" and "close is panel.js's local function", and reading those as
 * calls is exactly the false alarm that makes a static test get deleted.
 * Newlines are kept so a reported offence still lands on its own line.
 * @param {string} src
 */
function code(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\\])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length))
    .replace(/(['"`])(?:\\.|(?!\1)[^\\\n])*\1/g, (m) => m[0] + ' '.repeat(m.length - 2) + m[0]);
}

/**
 * Does this source declare a binding named `name`? Deliberately generous —
 * a false "yes" only means this check stays quiet about a call the module
 * genuinely owns, and the test is about calls no module owns at all.
 * @param {string} src @param {string} name
 */
function declares(src, name) {
  const n = name.replace(/[^\w]/g, '');
  return new RegExp(
    [
      `(?:function|class)\\s+${n}\\b`, // function close() {}
      `(?:const|let|var)\\s+[^=;\\n]*\\b${n}\\b[^=;\\n]*[=;]`, // let close, x = …  /  const { close } = …
      `\\b${n}\\s*[,}]\\s*=`, // ({ close } = o)
      `\\(\\s*(?:[^)]*,\\s*)?${n}\\s*(?:[,)])`, // (close) => …, function f(a, close)
      `\\b${n}\\s*:\\s*(?:function|\\(|async)`, // { close: () => … }
      `^\\s*${n}\\s*\\(`, // close() {} — a method in an object/class body
    ].join('|'),
    'm',
  ).test(src);
}

test('WP-61: no client module calls a window-closing global it does not own', () => {
  /** @type {string[]} */
  const offenders = [];
  for (const file of clientModules()) {
    const src = code(fs.readFileSync(file, 'utf8'));
    const rel = path.relative(PUBLIC, file).replace(/\\/g, '/');
    for (const name of ['close', 'open', 'print', 'stop']) {
      // A bare call: not `x.close()`, not `?.close()`, not `function close(`.
      const bare = new RegExp(`(^|[^.\\w$?])${name}\\s*\\(`, 'g');
      let m;
      let calls = 0;
      while ((m = bare.exec(src))) {
        const at = m.index + m[0].length - name.length - 1;
        const before = src.slice(Math.max(0, at - 40), at);
        // Declarations and method definitions are not calls.
        if (/(?:function|class|async)\s*$/.test(before)) continue;
        calls++;
      }
      if (calls > 0 && !declares(src, name)) {
        offenders.push(`${rel}: calls ${name}() with no binding of that name — window.${name}()`);
      }
    }
    // The explicit forms, which are never right in this product: the panel is
    // a region inside a page the user owns, and nothing in the client
    // navigates the tab.
    for (const forbidden of [
      'window.close(',
      'window.open(',
      'history.back(',
      'history.forward(',
      'location.replace(',
      'location.assign(',
    ]) {
      if (src.includes(forbidden)) offenders.push(`${rel}: ${forbidden})`);
    }
  }
  assert.deepEqual(offenders, [], 'these client files can close or navigate the tab');
});
